defmodule ForgeNexusWeb.ChatForumTopicController do
  use ForgeNexusWeb, :controller
  alias ForgeNexus.Channels.ForumTopics

  def context(conn, %{"slug" => slug, "id" => id}) do
    import Ecto.Query
    alias ForgeNexus.{Channels, Repo}
    alias ForgeNexus.Channels.ChannelMessage
    user = Guardian.Plug.current_resource(conn)

    with {:ok, id} <- Ecto.UUID.cast(id),
         channel when not is_nil(channel) <- Channels.get_channel_by_slug(slug),
         true <- Channels.can_view_channel?(user, channel),
         %ChannelMessage{channel_id: cid, is_deleted: false, thread_id: nil} = message <-
           Repo.get(ChannelMessage, id),
         true <- cid == channel.id do
      # Return a bounded conversation window, including messages older than the latest page.
      before =
        Repo.all(
          from(m in ChannelMessage,
            where:
              m.channel_id == ^cid and not m.is_deleted and is_nil(m.thread_id) and
                (m.inserted_at < ^message.inserted_at or
                   (m.inserted_at == ^message.inserted_at and m.id <= ^id)),
            order_by: [desc: m.inserted_at, desc: m.id],
            limit: 25,
            select: m.id
          )
        )

      after_ids =
        Repo.all(
          from(m in ChannelMessage,
            where:
              m.channel_id == ^cid and not m.is_deleted and is_nil(m.thread_id) and
                (m.inserted_at > ^message.inserted_at or
                   (m.inserted_at == ^message.inserted_at and m.id > ^id)),
            order_by: [asc: m.inserted_at, asc: m.id],
            limit: 25,
            select: m.id
          )
        )

      ids = before ++ after_ids

      messages =
        Repo.all(
          from(m in ChannelMessage,
            where: m.id in ^ids and not m.is_deleted,
            order_by: [asc: m.inserted_at, asc: m.id],
            preload: [
              :reactions,
              :spawned_thread,
              reply_to: [user: :primary_group],
              user: :primary_group
            ]
          )
        )
        |> Enum.map(&ForgeNexusWeb.ChannelController.message_json/1)

      json(conn, %{messages: messages})
    else
      _ -> conn |> put_status(:not_found) |> json(%{error: "Message not available"})
    end
  end

  def preview(conn, %{"slug" => slug} = params) do
    case ForumTopics.preview(
           Guardian.Plug.current_resource(conn),
           slug,
           params["message_ids"],
           conn.assigns.community_id
         ) do
      {:ok, data} -> json(conn, data)
      {:error, reason} -> failure(conn, reason)
    end
  end

  def create(conn, %{"slug" => slug} = params) do
    case ForumTopics.create(
           Guardian.Plug.current_resource(conn),
           slug,
           params,
           conn.assigns.community_id
         ) do
      {:ok, thread} ->
        conn
        |> put_status(:created)
        |> json(%{thread: %{id: thread.id, slug: thread.slug, title: thread.title}})

      {:error, reason} ->
        failure(conn, reason)
    end
  end

  defp failure(conn, reason) do
    {status, message} =
      case reason do
        :forbidden ->
          {403, "Only public text channels can be shared with a forum."}

        :not_found ->
          {404, "Channel not found."}

        :stale ->
          {409, "Messages changed. Close this preview and review your selection again."}

        :conflict ->
          {409, "This request was already used for a different topic."}

        :destination ->
          {422, "Choose an available public forum without restricted posting or approval rules."}

        :selection ->
          {422, "Some messages were removed or do not belong to this channel. Select them again."}

        :content ->
          {422,
           "The forum content checks blocked this topic. Try a different selection or wait before posting again."}

        :too_large ->
          {422, "Select fewer messages (up to 40,000 characters)."}

        _ ->
          {422, "Choose 1–20 messages and a title between 3 and 200 characters."}
      end

    conn |> put_status(status) |> json(%{error: message})
  end
end
