defmodule ForgeNexusWeb.SearchControllerTest do
  use ForgeNexusWeb.ConnCase, async: false
  alias ForgeNexus.Repo
  alias ForgeNexus.Accounts.User
  alias ForgeNexus.Forums.{Category, Forum, Thread, Post}

  setup do
    previous = Req.default_options()
    Req.default_options(plug: {Req.Test, __MODULE__})
    on_exit(fn -> Req.default_options(previous) end)
    Req.Test.stub(__MODULE__, fn conn -> Req.Test.transport_error(conn, :econnrefused) end)
    community = ForgeNexus.Communities.default_community_id()

    user =
      Repo.insert!(%User{
        username: "searcher",
        slug: "searcher",
        email: "search@example.test",
        password_hash: "unused"
      })

    category = Repo.insert!(%Category{name: "Search", slug: "search", community_id: community})

    forum =
      Repo.insert!(%Forum{
        name: "Search",
        slug: "search",
        category_id: category.id,
        community_id: community
      })

    thread =
      Repo.insert!(%Thread{
        title: "Needle topic",
        slug: "needle-topic",
        user_id: user.id,
        forum_id: forum.id,
        community_id: community
      })

    %{user: user, forum: forum, thread: thread, community: community}
  end

  defp make_post(ctx, attrs) do
    Repo.insert!(
      struct(
        Post,
        Map.merge(
          %{
            body: "needle content",
            body_html: "<p>needle content</p>",
            thread_id: ctx.thread.id,
            user_id: ctx.user.id,
            community_id: ctx.community,
            position: 1
          },
          attrs
        )
      )
    )
  end

  defp search(params), do: build_conn() |> get("/api/search", params) |> json_response(200)

  test "post outage fallback paginates, hydrates links and counts exactly", ctx do
    for i <- 1..27, do: make_post(ctx, %{position: i})
    first = search(%{q: "NEEDLE", type: "posts"})
    second = search(%{q: "needle", type: "posts", page: "2"})
    assert first["fallback"]
    assert first["total"] == 27
    assert first["total_pages"] == 2
    assert length(first["results"]) == 25
    assert length(second["results"]) == 2
    ids = Enum.map(first["results"] ++ second["results"], & &1["id"])
    assert length(Enum.uniq(ids)) == 27
    result = hd(first["results"])
    assert result["title"] == "Needle topic"
    assert result["excerpt"] == "needle content"
    assert result["url"] =~ "#post-"
    assert result["user"]["username"] == "searcher"
  end

  test "author and forum filters retain the requested result type", ctx do
    make_post(ctx, %{})

    for type <- ["threads", "posts"] do
      assert search(%{q: "needle", type: type, author: "SEARCHER", forum_id: ctx.forum.id})[
               "total"
             ] == 1

      assert search(%{q: "needle", type: type, author: "missing"})["total"] == 0
      assert search(%{q: "needle", type: type, forum_id: Ecto.UUID.generate()})["total"] == 0
    end
  end

  test "hidden and unapproved posts and private or unpublished parents are excluded", ctx do
    visible = make_post(ctx, %{})
    make_post(ctx, %{position: 2, is_hidden: true})
    make_post(ctx, %{position: 3, is_approved: false})
    assert Enum.map(search(%{q: "needle", type: "posts"})["results"], & &1["id"]) == [visible.id]

    for attrs <- [
          %{is_private: true},
          %{status: "draft"},
          %{is_hidden: true},
          %{is_approved: false}
        ] do
      ctx.thread |> Ecto.Changeset.change(attrs) |> Repo.update!()
      assert search(%{q: "needle", type: "posts"})["total"] == 0

      ctx.thread
      |> Ecto.Changeset.change(%{
        is_private: false,
        status: "published",
        is_hidden: false,
        is_approved: true
      })
      |> Repo.update!()
    end

    ctx.forum |> Ecto.Changeset.change(is_private: true) |> Repo.update!()
    assert search(%{q: "needle", type: "posts"})["total"] == 0
  end

  test "other communities are excluded even if an index hit references them", ctx do
    community =
      Repo.insert!(%ForgeNexus.Communities.Community{
        name: "Other",
        slug: "other",
        subdomain: "other"
      })

    other = ctx.thread |> Ecto.Changeset.change(community_id: community.id) |> Repo.update!()
    make_post(ctx, %{})

    Req.Test.stub(__MODULE__, fn conn ->
      Req.Test.json(conn, %{hits: [%{id: other.id}], estimatedTotalHits: 1})
    end)

    assert search(%{q: "needle", type: "threads"})["total"] == 0
    assert search(%{q: "needle", type: "posts"})["total"] == 0
  end

  test "fallback respects every term in a query longer than ten words", ctx do
    words = Enum.map_join(1..10, " ", &"word#{&1}")
    make_post(ctx, %{body: words})
    matching = make_post(ctx, %{body: words <> " required", position: 2})
    data = search(%{q: words <> " required", type: "posts"})
    assert data["total"] == 1
    assert Enum.map(data["results"], & &1["id"]) == [matching.id]
  end

  test "SQL wildcard characters are treated literally", ctx do
    make_post(ctx, %{body: "literal %_ marker"})
    make_post(ctx, %{body: "unrelated marker", position: 2})
    assert search(%{q: "%_", type: "posts"})["total"] == 1
  end

  test "healthy index preserves rank and hydrates database content", ctx do
    a = make_post(ctx, %{position: 1})
    b = make_post(ctx, %{position: 2})

    Req.Test.stub(__MODULE__, fn conn ->
      assert conn.request_path == "/indexes/posts/search"
      Req.Test.json(conn, %{hits: [%{id: b.id}, %{id: a.id}], estimatedTotalHits: 2})
    end)

    data = search(%{q: "needle", type: "posts"})
    refute data["fallback"]
    assert Enum.map(data["results"], & &1["id"]) == [b.id, a.id]
    assert hd(data["results"])["excerpt"] == "needle content"
  end

  test "server failures, malformed responses and stale hits recover through database", ctx do
    make_post(ctx, %{})

    for body <- [
          %{},
          %{hits: [%{id: "invalid"}], estimatedTotalHits: 1},
          %{hits: [%{id: Ecto.UUID.generate()}], estimatedTotalHits: 1}
        ] do
      Req.Test.stub(__MODULE__, fn conn -> Req.Test.json(conn, body) end)
      data = search(%{q: "needle", type: "posts"})
      assert data["fallback"] and data["total"] == 1
    end

    Req.Test.stub(__MODULE__, fn conn -> Plug.Conn.send_resp(conn, 503, "unavailable") end)
    assert search(%{q: "needle", type: "posts"})["total"] == 1
  end

  test "invalid search input returns a client error" do
    for params <- [
          %{q: "x"},
          %{q: ["needle"]},
          %{q: "needle", type: "bad"},
          %{q: "needle", forum_id: "invalid"}
        ] do
      assert build_conn() |> get("/api/search", params) |> json_response(400)
    end
  end
end
