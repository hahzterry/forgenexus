alias ForgeNexus.Repo
alias ForgeNexus.Channels.{ChannelCategory, Channel, ChannelMessage}
import Ecto.Query
config = Repo.config()
unless config[:database] == System.fetch_env!("FN_CI_DATABASE") and Regex.match?(~r/^forge_nexus_ci_[a-z0-9]+$/, config[:database]) and config[:hostname] in ["localhost", "127.0.0.1"], do: raise("Disposable loopback database required")
member = Repo.one!(from u in ForgeNexus.Accounts.User, where: u.username == "fncheck_ci")
peer = Repo.one!(from u in ForgeNexus.Accounts.User, where: u.username == "fnvoice_ci")
category = Repo.insert!(%ChannelCategory{name: "Integration Chat", slug: "integration-chat"})
channel = Repo.insert!(%Channel{name: "Workshop chat", slug: "workshop-chat", category_id: category.id})
private = Repo.insert!(%Channel{name: "Private chat", slug: "private-chat", category_id: category.id, is_private: true})
base = NaiveDateTime.add(NaiveDateTime.utc_now() |> NaiveDateTime.truncate(:second), -600)
old = Repo.insert!(%ChannelMessage{body: "Original historical discussion", channel_id: channel.id, user_id: member.id, inserted_at: base})
for n <- 1..55, do: Repo.insert!(%ChannelMessage{body: "Background message #{n}", channel_id: channel.id, user_id: member.id, inserted_at: NaiveDateTime.add(base,n)})
a = Repo.insert!(%ChannelMessage{body: "<script>window.quoteExecuted=true</script> Plan for the workshop", channel_id: channel.id, user_id: peer.id, inserted_at: NaiveDateTime.add(base,56)})
b = Repo.insert!(%ChannelMessage{body: "Let's make this a lasting discussion", channel_id: channel.id, user_id: member.id, inserted_at: NaiveDateTime.add(base,57)})
forum = Repo.one!(from f in ForgeNexus.Forums.Forum, where: f.slug == "ci-workshop")
File.write!(Path.join(System.fetch_env!("FN_TEST_FIXTURE_DIR"), "chat-forum.json"), Jason.encode!(%{channel: channel.slug, private: private.slug, first: a.id, second: b.id, old: old.id, forum_id: forum.id, forum_slug: forum.slug}))
