defmodule ForgeNexus.Repo.Migrations.AddChatForumConversions do
  use Ecto.Migration

  def change do
    create table(:chat_forum_conversions, primary_key: false) do
      add(:id, :uuid, primary_key: true)
      add(:user_id, references(:users, type: :uuid, on_delete: :delete_all), null: false)

      add(:channel_id, references(:chat_channels, type: :uuid, on_delete: :delete_all),
        null: false
      )

      add(:thread_id, references(:threads, type: :uuid, on_delete: :delete_all), null: false)
      add(:payload_hash, :string, null: false)
      timestamps()
    end
  end
end
