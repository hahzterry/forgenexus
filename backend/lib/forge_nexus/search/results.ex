defmodule ForgeNexus.Search.Results do
  @moduledoc "Database-backed result hydration and outage fallback for public search."
  import Ecto.Query
  alias ForgeNexus.{Repo, Search}
  alias ForgeNexus.Forums.{Thread, Post}

  def fetch(query, type, opts) do
    base = scope(type, opts)
    filters = []

    filters =
      if opts[:forum_id] && type == "threads",
        do: [~s(forum_id = "#{opts[:forum_id]}") | filters],
        else: filters

    filters =
      if opts[:author_id], do: [~s(user_id = "#{opts[:author_id]}") | filters], else: filters

    request = [
      limit: 25,
      offset: (opts[:page] - 1) * 25,
      filter: if(filters == [], do: nil, else: Enum.join(filters, " AND "))
    ]

    # The posts index has no forum filter. Use SQL for that filter rather than
    # paginating the global index and dropping unrelated hits afterwards.
    primary =
      cond do
        opts[:unknown_author] or (type == "posts" and opts[:forum_id]) ->
          {:error, :database_filter_required}

        type == "posts" ->
          Search.search_posts(query, request)

        true ->
          Search.search_threads(query, request)
      end

    case primary do
      {:ok, %{hits: hits, total: total}}
      when is_list(hits) and is_integer(total) and total >= 0 ->
        ids = Enum.map(hits, fn hit -> if is_map(hit), do: hit["id"] end)

        if Enum.all?(ids, &match?({:ok, _}, Ecto.UUID.cast(&1))) do
          rows = base |> where([result], result.id in ^ids) |> hydrate(type) |> Repo.all()
          indexed = Map.new(rows, &{&1.id, &1})

          if map_size(indexed) == length(ids),
            do: {Enum.map(ids, &Map.fetch!(indexed, &1)), total, false},
            else: fallback(base, query, type, opts[:page])
        else
          fallback(base, query, type, opts[:page])
        end

      _ ->
        fallback(base, query, type, opts[:page])
    end
    |> then(fn {rows, total, fallback} ->
      %{
        results: serialize(rows, type),
        total: total,
        page: opts[:page],
        per_page: 25,
        total_pages: max(1, ceil(total / 25)),
        type: type,
        fallback: fallback
      }
    end)
  end

  defp scope(type, opts) do
    base =
      if type == "posts" do
        from p in Post,
          join: t in assoc(p, :thread),
          as: :thread,
          join: f in assoc(t, :forum),
          as: :forum,
          where: not p.is_hidden and p.is_approved and p.community_id == ^opts[:community_id]
      else
        from t in Thread, as: :thread, join: f in assoc(t, :forum), as: :forum
      end

    base =
      from [thread: t, forum: f] in base,
        where:
          not t.is_hidden and t.is_approved and t.status == "published" and not t.is_private and
            f.is_visible and not f.is_private and t.community_id == ^opts[:community_id] and
            f.community_id == ^opts[:community_id]

    base = if opts[:forum_id], do: where(base, [forum: f], f.id == ^opts[:forum_id]), else: base

    base =
      if opts[:author_id],
        do: where(base, [result], result.user_id == ^opts[:author_id]),
        else: base

    if opts[:unknown_author], do: where(base, false), else: base
  end

  defp fallback(base, query, type, page) do
    tokens = String.split(query)

    matches =
      Enum.reduce(tokens, base, fn token, acc ->
        escaped =
          token
          |> String.replace("\\", "\\\\")
          |> String.replace("%", "\\%")
          |> String.replace("_", "\\_")

        pattern = "%" <> escaped <> "%"

        if type == "posts",
          do: where(acc, [p], ilike(p.body, ^pattern)),
          else: where(acc, [t], ilike(t.title, ^pattern))
      end)

    total = Repo.aggregate(matches, :count)

    rows =
      matches
      |> order_by([result], desc: result.inserted_at, desc: result.id)
      |> limit(25)
      |> offset(^((page - 1) * 25))
      |> hydrate(type)
      |> Repo.all()

    {rows, total, true}
  end

  defp hydrate(query, "posts"), do: preload(query, [:user, thread: :forum])
  defp hydrate(query, _), do: preload(query, [:user, :forum])
  defp person(user), do: %{id: user.id, username: user.username, slug: user.slug}
  defp forum(forum), do: %{id: forum.id, name: forum.name, slug: forum.slug}

  defp serialize(rows, "posts") do
    ids = Enum.map(rows, & &1.id)

    ranks =
      Repo.all(
        from p in Post,
          left_join: earlier in Post,
          on:
            earlier.thread_id == p.thread_id and not earlier.is_hidden and
              earlier.position < p.position,
          where: p.id in ^ids,
          group_by: p.id,
          select: {p.id, count(earlier.id)}
      )
      |> Map.new()

    Enum.map(rows, fn post ->
      page = div(Map.get(ranks, post.id, 0), 25) + 1

      %{
        id: post.id,
        thread_id: post.thread_id,
        title: post.thread.title,
        slug: post.thread.slug,
        excerpt: String.slice(post.body || "", 0, 300),
        position: post.position,
        url: "/threads/#{post.thread.slug}?page=#{page}#post-#{post.id}",
        inserted_at: post.inserted_at,
        user: person(post.user),
        forum: forum(post.thread.forum)
      }
    end)
  end

  defp serialize(rows, _),
    do:
      Enum.map(rows, fn thread ->
        %{
          id: thread.id,
          title: thread.title,
          slug: thread.slug,
          reply_count: thread.reply_count,
          view_count: thread.view_count,
          inserted_at: thread.inserted_at,
          last_post_at: thread.last_post_at,
          forum: forum(thread.forum),
          user: person(thread.user)
        }
      end)
end
