// Thin client for the Supabase Management API used by the repo scripts.
// The token comes from SUPABASE_ACCESS_TOKEN. In the Claude cloud environment the
// network proxy injects the real token into requests to api.supabase.com, so a
// placeholder value such as "proxy-injected" is enough there.

const API = "https://api.supabase.com/v1";

export function getConfig() {
  const ref = process.env.SUPABASE_PROJECT_REF ?? "jsfdewizzkyvbqziniou";
  const token = process.env.SUPABASE_ACCESS_TOKEN ?? "proxy-injected";
  return { ref, token };
}

export async function runSql(query, { ref, token } = getConfig()) {
  const res = await fetch(`${API}/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Management API ${res.status}: ${text.slice(0, 2000)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}
