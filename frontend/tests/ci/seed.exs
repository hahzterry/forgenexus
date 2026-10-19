# Disposable CI fixtures only. Never run against a development or production database.
alias ForgeNexus.Repo
alias ForgeNexus.Accounts.{User, UserGroup, UserGroupMembership}
alias ForgeNexus.Forums.{Category, Forum, Thread, Post}

config = Repo.config()
database = Keyword.fetch!(config, :database)

unless database == System.fetch_env!("FN_CI_DATABASE") and
         Regex.match?(~r/^forge_nexus_ci(?:_[a-z0-9]+)?$/, database) and
         Keyword.fetch!(config, :hostname) in ["localhost", "127.0.0.1"] do
  raise "CI fixture seeding requires a named loopback CI database"
end

if Repo.aggregate(User, :count) != 0,
  do: raise("CI database must have no users; choose a fresh database name")

now = DateTime.utc_now() |> DateTime.truncate(:second)
group = Repo.insert!(%UserGroup{name: "CI Members", slug: "ci-members", is_default: true})

make_user = fn name ->
  password = "Fn9!" <> Base.encode16(:crypto.strong_rand_bytes(16))

  user =
    Repo.insert!(%User{
      username: name,
      slug: name,
      email: name <> "@example.test",
      password_hash: Bcrypt.hash_pwd_salt(password),
      display_name: name,
      status: "active",
      email_verified_at: now
    })

  Repo.insert!(%UserGroupMembership{user_id: user.id, group_id: group.id})
  {user, %{id: user.id, email: user.email, password: password}}
end

{member, credentials} = make_user.("fncheck_ci")
{_peer, peer_credentials} = make_user.("fnvoice_ci")
category = Repo.insert!(%Category{name: "CI Integration", slug: "ci-integration"})
forum = Repo.insert!(%Forum{name: "CI Workshop", slug: "ci-workshop", category_id: category.id})

thread =
  Repo.insert!(%Thread{
    title: "CI live media integration",
    slug: "ci-live-media-integration",
    forum_id: forum.id,
    user_id: member.id
  })

Repo.insert!(%Post{
  body: "Disposable CI integration fixture",
  body_html: "<p>Disposable CI integration fixture</p>",
  is_first_post: true,
  position: 1,
  thread_id: thread.id,
  user_id: member.id
})

{:ok, room} =
  ForgeNexus.Voice.create_room(%{
    name: "CI voice integration check",
    slug: "ci-voice-integration-check",
    type: "lounge"
  })

for {key, value} <- [
      {"livekit_url", "ws://127.0.0.1:7880"},
      {"livekit_api_key", "devkey"},
      {"livekit_api_secret", "secret"}
    ] do
  {:ok, _} = ForgeNexus.Settings.set(key, value)
end

output = System.fetch_env!("FN_TEST_FIXTURE_DIR")
File.mkdir_p!(output)

for {name, value} <- [
      {"member.json", Map.put(credentials, :threadSlug, thread.slug)},
      {"participant.json", peer_credentials},
      {"room.json", %{id: room.id, name: room.name}}
    ] do
  target = Path.join(output, name)
  File.write!(target, Jason.encode!(value))
  File.chmod!(target, 0o600)
end

IO.puts("Disposable CI fixtures created")
