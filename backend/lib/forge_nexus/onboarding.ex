defmodule ForgeNexus.Onboarding do
  @moduledoc "Optional per-account orientation; reviewed steps are explicit acknowledgements."
  import Ecto.Query
  alias ForgeNexus.{Repo, Accounts}
  alias ForgeNexus.Accounts.UserPreference
  @steps ~w(explore follow introduce live)
  def get(user_id), do: Accounts.get_preferences(user_id) |> serialize()

  def update(user_id, params) when is_map(params) do
    Accounts.get_preferences(user_id)

    Repo.transaction(fn ->
      pref = Repo.one!(from p in UserPreference, where: p.user_id == ^user_id, lock: "FOR UPDATE")

      changes =
        case params do
          %{"action" => "start"} ->
            %{
              onboarding_status:
                if(pref.onboarding_status == "completed", do: "completed", else: "active"),
              navigation_mode: "simple"
            }

          %{"action" => "review", "step" => step} when step in @steps ->
            %{
              onboarding_steps: Enum.uniq(pref.onboarding_steps ++ [step]),
              onboarding_status:
                if(pref.onboarding_status == "completed", do: "completed", else: "active")
            }

          %{"action" => "pause"} ->
            %{onboarding_status: "paused"}

          %{"action" => "complete"} ->
            if Enum.all?(@steps, &(&1 in pref.onboarding_steps)),
              do: %{onboarding_status: "completed"},
              else: Repo.rollback(:incomplete)

          %{"action" => "restart"} ->
            %{onboarding_status: "active", onboarding_steps: [], navigation_mode: "simple"}

          %{"action" => "navigation", "mode" => mode} when mode in ["simple", "full"] ->
            %{navigation_mode: mode}

          _ ->
            Repo.rollback(:invalid)
        end

      pref |> Ecto.Changeset.change(changes) |> Repo.update!() |> serialize()
    end)
  end

  def update(_, _), do: {:error, :invalid}

  defp serialize(pref),
    do: %{
      status: pref.onboarding_status,
      reviewed_steps: pref.onboarding_steps,
      navigation_mode: pref.navigation_mode
    }
end
