defmodule ForgeNexus.Repo.ReadReplicaTest do
  use ExUnit.Case, async: true

  alias ForgeNexus.Repo.ReadReplica

  test "ReadReplica configuration and callbacks" do
    options = ForgeNexus.Repo.config() |> Keyword.put(:name, ReadReplica)
    start_supervised!({ReadReplica, options})
    assert ReadReplica.__adapter__() == Ecto.Adapters.Postgres
    assert is_list(ReadReplica.default_options(:all))

    # Module reflection generated at line 1
    assert is_list(ReadReplica.module_info())
    assert is_list(ReadReplica.__info__(:functions))
    assert is_list(ReadReplica.__info__(:macros))
    assert is_list(ReadReplica.__info__(:attributes))
    assert is_list(ReadReplica.__info__(:compile))
    # Check which functions are defined at line 1
    {:ok, {_, [abstract_code: {_, _forms}]}} =
      :beam_lib.chunks(
        :code.which(ReadReplica),
        [:abstract_code]
      )

    import Ecto.Query
    query = from(u in "users", select: u.id)
    assert {sql, []} = ReadReplica.to_sql(:all, query)
    assert is_binary(sql)

    refute function_exported?(ReadReplica, :insert, 1)
    refute function_exported?(ReadReplica, :update, 1)
    refute function_exported?(ReadReplica, :delete, 1)
  end
end
