import { PERSONAS } from "@/lib/idp/mock";

/** Stand-in for the Okta hosted sign-in page when running offline. */
export default async function MockLogin({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { state = "", nonce = "", code_challenge = "" } = await searchParams;
  return (
    <div className="center">
      <div className="card">
        <h1>Sign in</h1>
        <p>Mock identity provider · pick a demo persona. With DEMO_MODE=okta this is your real Okta sign-in page.</p>
        <form method="post" action="/api/mock-idp/authorize">
          <input type="hidden" name="state" value={state} />
          <input type="hidden" name="nonce" value={nonce} />
          <input type="hidden" name="code_challenge" value={code_challenge} />
          {PERSONAS.map((p) => (
            <button key={p.sub} className="persona" name="persona" value={p.sub}>
              <span className="avatar">{p.name.split(" ").map((w) => w[0]).join("")}</span>
              <span>
                <strong>{p.name}</strong>
                <br />
                <span className="muted">
                  {p.title} · {p.email}
                </span>
              </span>
            </button>
          ))}
        </form>
      </div>
    </div>
  );
}
