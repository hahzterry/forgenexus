defmodule ForgeNexus.Repo.Migrations.AddMemberOnboardingPreferences do
  use Ecto.Migration

  def change do
    alter table(:user_preferences) do
      add :onboarding_status, :string, default: "not_started", null: false
      add :onboarding_steps, {:array, :string}, default: [], null: false
      add :navigation_mode, :string, default: "full", null: false
    end
  end
end
