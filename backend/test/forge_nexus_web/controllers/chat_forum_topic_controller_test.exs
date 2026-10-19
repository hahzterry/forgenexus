defmodule ForgeNexusWeb.ChatForumTopicControllerTest do
  use ForgeNexusWeb.ConnCase, async: false
  alias ForgeNexus.{Repo, Guardian}
  alias ForgeNexus.Channels.{Channel, ChannelMessage}
  alias ForgeNexus.Forums.{Category, Forum, Thread, Post}

  setup do
    c = ForgeNexus.Communities.default_community_id()

    user =
      Repo.insert!(%ForgeNexus.Accounts.User{
        username: "chat_writer",
        slug: "chat-writer",
        email: "chat-writer@example.test",
        password_hash: "unused",
        status: "active",
        email_verified_at: DateTime.utc_now() |> DateTime.truncate(:second)
      })

    peer =
      Repo.insert!(%ForgeNexus.Accounts.User{
        username: "peer",
        slug: "peer",
        email: "peer@example.test",
        password_hash: "unused"
      })

    category = Repo.insert!(%Category{name: "Topics", slug: "topics", community_id: c})

    forum =
      Repo.insert!(%Forum{
        name: "Topics",
        slug: "topics",
        category_id: category.id,
        community_id: c
      })

    channel = Repo.insert!(%Channel{name: "Workshop", slug: "workshop"})

    first =
      Repo.insert!(%ChannelMessage{
        body: "<script>alert(1)</script> [url=javascript:bad]quoted[/url]",
        user_id: peer.id,
        channel_id: channel.id,
        inserted_at: ~N[2026-01-01 00:00:00]
      })

    second =
      Repo.insert!(%ChannelMessage{
        body: "Another useful idea",
        user_id: user.id,
        channel_id: channel.id,
        inserted_at: ~N[2026-01-01 00:01:00]
      })

    %{user: user, forum: forum, channel: channel, first: first, second: second}
  end

  defp conn_for(user) do
    {:ok, token, _} = Guardian.encode_and_sign(user)
    build_conn() |> put_req_header("authorization", "Bearer " <> token)
  end

  defp preview(ctx, ids \\ nil) do
    conn_for(ctx.user)
    |> post("/api/channels/workshop/forum-topic/preview", %{
      message_ids: ids || [ctx.second.id, ctx.first.id]
    })
    |> json_response(200)
  end

  defp params(ctx) do
    %{
      message_ids: [ctx.second.id, ctx.first.id],
      revision: preview(ctx)["revision"],
      request_id: Ecto.UUID.generate(),
      title: "Useful chat ideas",
      forum_id: ctx.forum.id
    }
  end

  defp create(ctx, params),
    do: conn_for(ctx.user) |> post("/api/channels/workshop/forum-topic", params)

  test "preview orders stored messages and creation preserves escaped attribution and source links",
       ctx do
    p = preview(ctx)
    assert hd(p["messages"])["inserted_at"] == "2026-01-01T00:00:00Z"
    assert Enum.map(p["messages"], & &1["username"]) == ["peer", "chat_writer"]

    response =
      create(ctx, Map.put(params(ctx), :body_html, "<script>forged</script>"))
      |> json_response(201)

    thread = Repo.get!(Thread, response["thread"]["id"])
    assert thread.user_id == ctx.user.id
    post = Repo.get_by!(Post, thread_id: thread.id)
    assert post.body_html =~ "&lt;script&gt;alert(1)&lt;/script&gt;"
    refute post.body_html =~ "<script>"
    assert post.body_html =~ "<strong>peer</strong>"
    assert post.body_html =~ "message=#{ctx.first.id}"
    assert Repo.get!(Forum, ctx.forum.id).thread_count == 1
  end

  test "retry returns original topic without duplicating counters and conflicts reject reuse",
       ctx do
    p = params(ctx)
    first = create(ctx, p) |> json_response(201)
    assert create(ctx, p) |> json_response(201) == first
    assert Repo.aggregate(Thread, :count) == 1
    assert Repo.get!(Forum, ctx.forum.id).thread_count == 1
    assert create(ctx, Map.put(p, :title, "Different topic")) |> json_response(409)
  end

  test "edited and deleted messages require a fresh selection without partial writes", ctx do
    p = params(ctx)
    ctx.first |> Ecto.Changeset.change(body: "edited") |> Repo.update!()
    assert create(ctx, p) |> json_response(409)
    ctx.second |> Ecto.Changeset.change(is_deleted: true) |> Repo.update!()
    assert create(ctx, p) |> json_response(422)
    assert Repo.aggregate(Thread, :count) == 0
  end

  test "private sources and locked/private/approval destinations are rejected", ctx do
    p = params(ctx)

    for attrs <- [
          %{is_locked: true},
          %{is_private: true},
          %{require_post_approval: true},
          %{permissions: %{"can_post" => false}}
        ] do
      ctx.forum |> Ecto.Changeset.change(attrs) |> Repo.update!()
      assert create(ctx, p) |> json_response(422)

      ctx.forum
      |> Ecto.Changeset.change(
        is_locked: false,
        is_private: false,
        require_post_approval: false,
        permissions: %{}
      )
      |> Repo.update!()
    end

    ctx.channel |> Ecto.Changeset.change(is_private: true) |> Repo.update!()

    assert conn_for(ctx.user)
           |> post("/api/channels/workshop/forum-topic/preview", %{message_ids: [ctx.first.id]})
           |> json_response(403)

    assert Repo.aggregate(Thread, :count) == 0
  end

  test "mixed channels, duplicates, malformed IDs and oversized selections are rejected", ctx do
    other = Repo.insert!(%Channel{name: "Other", slug: "other"})

    foreign =
      Repo.insert!(%ChannelMessage{body: "private", user_id: ctx.user.id, channel_id: other.id})

    for ids <- [
          [foreign.id],
          [ctx.first.id, ctx.first.id],
          ["bad"],
          [],
          Enum.map(1..21, fn _ -> Ecto.UUID.generate() end)
        ] do
      assert conn_for(ctx.user)
             |> post("/api/channels/workshop/forum-topic/preview", %{message_ids: ids})
             |> json_response(422)
    end
  end

  test "guest cannot preview or create a topic", ctx do
    assert build_conn()
           |> post("/api/channels/workshop/forum-topic/preview", %{message_ids: [ctx.first.id]})
           |> json_response(401)
  end

  test "context resolves old messages and does not expose a different channel or deleted message",
       ctx do
    for n <- 1..55,
        do:
          Repo.insert!(%ChannelMessage{
            body: "later #{n}",
            user_id: ctx.user.id,
            channel_id: ctx.channel.id
          })

    data =
      conn_for(ctx.user)
      |> get("/api/channels/workshop/messages/#{ctx.first.id}/context")
      |> json_response(200)

    assert Enum.any?(data["messages"], &(&1["id"] == ctx.first.id))
    assert length(data["messages"]) <= 50
    ctx.first |> Ecto.Changeset.change(is_deleted: true) |> Repo.update!()

    assert conn_for(ctx.user)
           |> get("/api/channels/workshop/messages/#{ctx.first.id}/context")
           |> json_response(404)
  end
end
