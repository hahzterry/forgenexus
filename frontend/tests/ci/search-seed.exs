alias ForgeNexus.Repo
alias ForgeNexus.Forums.{Thread, Post}
import Ecto.Query
unless Repo.config()[:database] == System.fetch_env!("FN_CI_DATABASE") and String.starts_with?(Repo.config()[:database], "forge_nexus_ci_"), do: raise("Disposable database required")
thread = Repo.one!(from t in Thread, where: t.slug == "ci-live-media-integration")
for n <- 2..28 do
  Repo.insert!(%Post{body: "SearchReliability needle #{n}", body_html: "<p>SearchReliability needle #{n}</p>", position: n, thread_id: thread.id, user_id: thread.user_id})
end
Repo.insert!(%Post{body: "SearchReliability hidden", body_html: "hidden", position: 29, thread_id: thread.id, user_id: thread.user_id, is_hidden: true})
