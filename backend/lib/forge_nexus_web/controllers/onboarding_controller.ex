defmodule ForgeNexusWeb.OnboardingController do
  use ForgeNexusWeb, :controller
  alias ForgeNexus.Onboarding

  def show(conn, _),
    do: json(conn, %{onboarding: Onboarding.get(Guardian.Plug.current_resource(conn).id)})

  def update(conn, params) do
    case Onboarding.update(Guardian.Plug.current_resource(conn).id, params) do
      {:ok, state} ->
        json(conn, %{onboarding: state})

      {:error, _} ->
        conn
        |> put_status(422)
        |> json(%{
          error: "Choose a valid action. Review all four steps before finishing the guide."
        })
    end
  end
end
