defmodule ForgeNexusWeb.OnboardingControllerTest do
  use ForgeNexusWeb.ConnCase, async: false
  alias ForgeNexus.{Repo, Guardian}

  setup do
    user =
      Repo.insert!(%ForgeNexus.Accounts.User{
        username: "guide_member",
        slug: "guide-member",
        email: "guide@example.test",
        password_hash: "unused",
        status: "active"
      })

    %{user: user}
  end

  defp conn_for(user) do
    {:ok, token, _} = Guardian.encode_and_sign(user)
    build_conn() |> put_req_header("authorization", "Bearer " <> token)
  end

  defp state(user),
    do: conn_for(user) |> get("/api/onboarding") |> json_response(200) |> Map.fetch!("onboarding")

  defp update(user, params), do: conn_for(user) |> put("/api/onboarding", params)

  test "existing users retain full navigation and an unstarted optional guide", %{user: user} do
    assert state(user) == %{
             "status" => "not_started",
             "reviewed_steps" => [],
             "navigation_mode" => "full"
           }
  end

  test "unverified members can start, review, pause and resume without losing progress", %{
    user: user
  } do
    assert update(user, %{action: "start"}) |> json_response(200)
    for _ <- 1..2, do: update(user, %{action: "review", step: "explore"}) |> json_response(200)
    assert state(user)["reviewed_steps"] == ["explore"]
    update(user, %{action: "pause"}) |> json_response(200)
    assert state(user)["status"] == "paused"
    update(user, %{action: "start"}) |> json_response(200)
    assert state(user)["reviewed_steps"] == ["explore"]
  end

  test "completion requires reviewed steps; navigation choice and restart persist", %{user: user} do
    assert update(user, %{action: "complete"}) |> json_response(422)

    for step <- ~w(explore follow introduce live),
        do: update(user, %{action: "review", step: step}) |> json_response(200)

    update(user, %{action: "complete"}) |> json_response(200)
    update(user, %{action: "navigation", mode: "full"}) |> json_response(200)
    assert state(user)["status"] == "completed"
    assert state(user)["navigation_mode"] == "full"
    update(user, %{action: "restart"}) |> json_response(200)
    assert state(user)["reviewed_steps"] == []
  end

  test "invalid input cannot mutate progress or someone else's state", %{user: user} do
    other =
      Repo.insert!(%ForgeNexus.Accounts.User{
        username: "other",
        slug: "other",
        email: "other@example.test",
        password_hash: "unused"
      })

    for params <- [
          %{action: "review", step: "unknown"},
          %{action: "navigation", mode: "invalid"},
          %{action: "review", step: ["live"]}
        ] do
      assert update(user, params) |> json_response(422)
    end

    update(user, %{action: "review", step: "live", user_id: other.id}) |> json_response(200)
    assert state(other)["reviewed_steps"] == []
  end

  test "anonymous requests do not read or save progress" do
    assert build_conn() |> get("/api/onboarding") |> json_response(401)
    assert build_conn() |> put("/api/onboarding", %{action: "start"}) |> json_response(401)
  end

  test "new registration creates simple navigation and active onboarding atomically" do
    previous = Req.default_options()
    Req.default_options(plug: {Req.Test, __MODULE__})
    Req.Test.stub(__MODULE__, fn conn -> Plug.Conn.send_resp(conn, 404, "") end)
    on_exit(fn -> Req.default_options(previous) end)

    {:ok, user} =
      ForgeNexus.Accounts.register_user(%{
        username: "new_guide_user",
        email: "new-guide@example.test",
        password: "Fn9!LongUniqueSetup42"
      })

    assert state(user)["status"] == "active"
    assert state(user)["navigation_mode"] == "simple"
  end
end
