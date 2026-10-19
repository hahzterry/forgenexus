defmodule ForgeNexusWeb.SearchController do
  use ForgeNexusWeb, :controller
  import Ecto.Query
  alias ForgeNexus.Repo
  alias ForgeNexus.Accounts.User
  alias ForgeNexus.Search.Results

  def search(conn, params) do
    with {:ok, query} <- text(params["q"], 2, 200),
         type when type in ["threads", "posts"] <- Map.get(params, "type", "threads"),
         {:ok, author} <- text(params["author"] || "", 0, 100),
         {:ok, forum_id} <- forum_id(params["forum_id"]) do
      author_id =
        if author != "",
          do:
            Repo.one(
              from u in User,
                where: fragment("lower(?) = lower(?)", u.username, ^author),
                select: u.id,
                limit: 1
            )

      opts = [
        page: page(params["page"]),
        author_id: author_id,
        unknown_author: author != "" and is_nil(author_id),
        forum_id: forum_id,
        community_id: conn.assigns[:community_id] || ForgeNexus.Communities.default_community_id()
      ]

      json(conn, Results.fetch(query, type, opts))
    else
      _ ->
        conn
        |> put_status(:bad_request)
        |> json(%{
          error: "Use a 2–200 character query, a valid search type, author, and forum ID."
        })
    end
  end

  defp text(value, min, max) when is_binary(value) do
    value = String.trim(value)
    if String.length(value) in min..max, do: {:ok, value}, else: :error
  end

  defp text(_, _, _), do: :error
  defp forum_id(value) when value in [nil, ""], do: {:ok, nil}
  defp forum_id(value), do: Ecto.UUID.cast(value)

  defp page(value) when is_binary(value) do
    case Integer.parse(value) do
      {number, ""} -> number |> max(1) |> min(10_000)
      _ -> 1
    end
  end

  defp page(_), do: 1
end
