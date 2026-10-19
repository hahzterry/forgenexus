defmodule ForgeNexus.Channels.ForumConversion do
  use Ecto.Schema
  @primary_key {:id, :binary_id, autogenerate: false}
  @foreign_key_type :binary_id
  schema "chat_forum_conversions" do
    belongs_to(:user, ForgeNexus.Accounts.User)
    belongs_to(:channel, ForgeNexus.Channels.Channel)
    belongs_to(:thread, ForgeNexus.Forums.Thread)
    field(:payload_hash, :string)
    timestamps()
  end
end
