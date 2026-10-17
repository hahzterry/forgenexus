defmodule ForgeNexusWeb.StatsControllerTest do
  use ForgeNexusWeb.ConnCase, async: false

  alias ForgeNexus.Repo
  alias ForgeNexus.Accounts.User
  alias ForgeNexus.Forums.{Category, Forum, Thread, Post}

  defp welcome(conn) do
    conn
    |> get(~p"/api/stats/welcome")
    |> json_response(200)
    |> Map.fetch!("welcome")
  end

  test "welcome includes live daily counts and recent-thread author and reply data", %{conn: conn} do
    before = welcome(conn)["stats"]
    unique = System.unique_integer([:positive])

    user =
      Repo.insert!(%User{
        username: "stats_#{unique}",
        slug: "stats-#{unique}",
        email: "stats_#{unique}@example.test",
        password_hash: "test-only"
      })

    category = Repo.insert!(%Category{name: "Stats #{unique}", slug: "stats-#{unique}"})

    forum =
      Repo.insert!(%Forum{
        name: "Stats #{unique}",
        slug: "stats-#{unique}",
        category_id: category.id
      })

    thread =
      Repo.insert!(%Thread{
        title: "Welcome stats #{unique}",
        slug: "welcome-stats-#{unique}",
        forum_id: forum.id,
        user_id: user.id,
        reply_count: 1,
        last_post_at: DateTime.utc_now() |> DateTime.truncate(:second)
      })

    Repo.insert!(%Post{body: "First post", user_id: user.id, thread_id: thread.id, position: 1})
    Repo.insert!(%Post{body: "A reply", user_id: user.id, thread_id: thread.id, position: 2})

    data = welcome(Phoenix.ConnTest.build_conn())
    assert data["stats"]["new_members_today"] == before["new_members_today"] + 1
    assert data["stats"]["threads_today"] == before["threads_today"] + 1
    assert data["stats"]["posts_today"] == before["posts_today"] + 2
    recent = Enum.find(data["recent_threads"], &(&1["id"] == thread.id))
    assert recent["reply_count"] == 1
    assert recent["user"]["username"] == user.username
  end

  test "daily activity excludes hidden content and previous days", %{conn: conn} do
    before = welcome(conn)["stats"]
    unique = System.unique_integer([:positive])

    yesterday =
      NaiveDateTime.utc_now() |> NaiveDateTime.add(-86_400) |> NaiveDateTime.truncate(:second)

    user =
      Repo.insert!(%User{
        username: "old_stats_#{unique}",
        slug: "old-stats-#{unique}",
        email: "old_stats_#{unique}@example.test",
        password_hash: "test-only",
        inserted_at: yesterday
      })

    category =
      Repo.insert!(%Category{name: "Hidden stats #{unique}", slug: "hidden-stats-#{unique}"})

    forum =
      Repo.insert!(%Forum{
        name: "Hidden stats #{unique}",
        slug: "hidden-stats-#{unique}",
        category_id: category.id
      })

    hidden =
      Repo.insert!(%Thread{
        title: "Hidden",
        slug: "hidden-#{unique}",
        forum_id: forum.id,
        user_id: user.id,
        is_hidden: true
      })

    Repo.insert!(%Post{body: "Hidden", user_id: user.id, thread_id: hidden.id, is_hidden: true})

    old =
      Repo.insert!(%Thread{
        title: "Yesterday",
        slug: "yesterday-#{unique}",
        forum_id: forum.id,
        user_id: user.id,
        inserted_at: yesterday
      })

    Repo.insert!(%Post{
      body: "Yesterday",
      user_id: user.id,
      thread_id: old.id,
      inserted_at: yesterday
    })

    after_stats = welcome(Phoenix.ConnTest.build_conn())["stats"]
    assert after_stats["new_members_today"] == before["new_members_today"]
    assert after_stats["threads_today"] == before["threads_today"]
    assert after_stats["posts_today"] == before["posts_today"]
  end
end
