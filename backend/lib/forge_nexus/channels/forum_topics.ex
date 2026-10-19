defmodule ForgeNexus.Channels.ForumTopics do
  @moduledoc "Creates attributed public forum topics from reviewed public channel messages."
  import Ecto.Query
  alias ForgeNexus.{Repo, Channels, Accounts, Forums}
  alias ForgeNexus.Channels.{Channel, ChannelMessage, ForumConversion}
  alias ForgeNexus.Forums.{Forum, ForumPermission}

  def preview(user, slug, ids, community) do
    with {:ok, channel} <- source(user, slug, community),
         {:ok, messages} <- selected(channel, ids, false) do
      {:ok,
       %{
         channel: %{name: channel.name, slug: channel.slug},
         messages:
           Enum.map(messages, fn m ->
             %{
               id: m.id,
               body: m.body,
               username: m.user.username,
               inserted_at: timestamp(m),
               url: source_url(channel, m)
             }
           end),
         revision: revision(messages),
         forums: Enum.map(destinations(community) |> Repo.all(), &%{id: &1.id, name: &1.name})
       }}
    end
  end

  def create(user, slug, params, community) do
    with {:ok, request_id} <- Ecto.UUID.cast(params["request_id"]),
         title when is_binary(title) <- params["title"],
         title <- String.trim(title),
         true <- String.length(title) in 3..200,
         {:ok, forum_id} <- Ecto.UUID.cast(params["forum_id"]),
         {:ok, channel} <- source(user, slug, community) do
      Repo.transaction(fn ->
        # Serialize conversions per channel, including retries of the same request.
        channel = Repo.one!(from(c in Channel, where: c.id == ^channel.id, lock: "FOR UPDATE"))
        if channel.is_private or channel.type != "text", do: Repo.rollback(:forbidden)
        hash = digest({params["message_ids"], params["revision"], title, forum_id})

        case Repo.get(ForumConversion, request_id) do
          %ForumConversion{user_id: uid, channel_id: cid, payload_hash: ^hash, thread_id: tid}
          when uid == user.id and cid == channel.id ->
            Repo.get!(Forums.Thread, tid)

          %ForumConversion{} ->
            Repo.rollback(:conflict)

          nil ->
            with {:ok, messages} <- selected(channel, params["message_ids"], true),
                 true <- params["revision"] == revision(messages),
                 %Forum{} <-
                   Repo.one(
                     from(f in destinations(community),
                       where: f.id == ^forum_id,
                       lock: "FOR UPDATE"
                     )
                   ),
                 {body, html} <- content(channel, messages),
                 {:ok, thread} <-
                   Forums.create_thread(%{
                     "title" => title,
                     "forum_id" => forum_id,
                     "user_id" => user.id,
                     "body" => body,
                     "body_html" => html
                   }) do
              # Quoted markup stays text; do not infer a thumbnail from it.
              thread =
                if thread.thumbnail_url,
                  do: thread |> Ecto.Changeset.change(thumbnail_url: nil) |> Repo.update!(),
                  else: thread

              %ForumConversion{
                id: request_id,
                user_id: user.id,
                channel_id: channel.id,
                thread_id: thread.id,
                payload_hash: hash
              }
              |> Ecto.Changeset.change()
              |> Ecto.Changeset.unique_constraint(:id, name: :chat_forum_conversions_pkey)
              |> Repo.insert()
              |> case do
                {:ok, _} -> thread
                {:error, _} -> Repo.rollback(:conflict)
              end
            else
              false -> Repo.rollback(:stale)
              nil -> Repo.rollback(:destination)
              {:error, reason} -> Repo.rollback(reason)
              {:error, :spam_detected, _} -> Repo.rollback(:content)
            end
        end
      end)
    else
      {:error, reason} when is_atom(reason) -> {:error, reason}
      _ -> {:error, :invalid}
    end
  end

  defp source(user, slug, community) do
    channel = Channels.get_channel_by_slug(slug)

    cond do
      not Accounts.user_has_permission?(user, "can_create_threads") ->
        {:error, :forbidden}

      community != ForgeNexus.Communities.default_community_id() ->
        {:error, :forbidden}

      is_nil(channel) ->
        {:error, :not_found}

      channel.is_private or channel.type != "text" or
          not Channels.can_view_channel?(user, channel) ->
        {:error, :forbidden}

      true ->
        {:ok, channel}
    end
  end

  defp selected(channel, ids, lock) when is_list(ids) and length(ids) in 1..20 do
    if length(Enum.uniq(ids)) == length(ids) and
         Enum.all?(ids, &match?({:ok, _}, Ecto.UUID.cast(&1))) do
      query =
        from(m in ChannelMessage,
          where:
            m.channel_id == ^channel.id and m.id in ^ids and
              not m.is_deleted and is_nil(m.thread_id),
          order_by: [asc: m.inserted_at, asc: m.id],
          preload: [:user]
        )

      query = if lock, do: lock(query, "FOR SHARE"), else: query
      messages = Repo.all(query)

      cond do
        length(messages) != length(ids) -> {:error, :selection}
        Enum.reduce(messages, 0, &(String.length(&1.body) + &2)) > 40_000 -> {:error, :too_large}
        true -> {:ok, messages}
      end
    else
      {:error, :invalid}
    end
  end

  defp selected(_, _, _), do: {:error, :invalid}

  defp destinations(community) do
    from(f in Forum,
      as: :forum,
      where:
        f.community_id == ^community and f.is_visible and not f.is_private and
          not f.is_locked and not f.require_post_approval and f.permissions == ^%{},
      where: not exists(from(p in ForumPermission, where: p.forum_id == parent_as(:forum).id)),
      order_by: [asc: f.position, asc: f.name]
    )
  end

  defp digest(value),
    do: :crypto.hash(:sha256, :erlang.term_to_binary(value)) |> Base.encode16(case: :lower)

  defp revision(messages),
    do: digest(Enum.map(messages, &{&1.id, &1.body, &1.updated_at, &1.user.username}))

  defp timestamp(message),
    do: message.inserted_at |> DateTime.from_naive!("Etc/UTC") |> DateTime.to_iso8601()

  defp source_url(c, m), do: "/chat?channel=#{URI.encode_www_form(c.slug)}&message=#{m.id}"
  defp escape(text), do: text |> Phoenix.HTML.html_escape() |> Phoenix.HTML.safe_to_string()

  defp content(channel, messages) do
    text =
      "Selected messages from ##{channel.name}\n\n" <>
        Enum.map_join(messages, "\n\n", fn m ->
          "#{m.user.username} — #{timestamp(m)}\n#{source_url(channel, m)}\n#{m.body}"
        end)

    html =
      "<p>Selected messages from ##{escape(channel.name)}</p>" <>
        Enum.map_join(messages, "", fn m ->
          "<blockquote><p><strong>#{escape(m.user.username)}</strong> — #{escape(timestamp(m))} · <a href=\"#{escape(source_url(channel, m))}\">View original message</a></p><p>#{escape(m.body) |> String.replace("\n", "<br>")}</p></blockquote>"
        end)

    {text, html}
  end
end
