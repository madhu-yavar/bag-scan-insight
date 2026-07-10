import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

loadEnvFile(".env");
loadEnvFile(".env.local");

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const operators = [
  {
    email: process.env.OPERATOR_1_EMAIL,
    password: process.env.OPERATOR_1_PASSWORD,
  },
  {
    email: process.env.OPERATOR_2_EMAIL,
    password: process.env.OPERATOR_2_PASSWORD,
  },
].filter((operator) => operator.email || operator.password);

if (!supabaseUrl) fail("Missing SUPABASE_URL or VITE_SUPABASE_URL.");
if (!serviceRoleKey) fail("Missing SUPABASE_SERVICE_ROLE_KEY.");
if (operators.length === 0) fail("Set OPERATOR_1_EMAIL/OPERATOR_1_PASSWORD.");

for (const [index, operator] of operators.entries()) {
  if (!operator.email) fail(`Missing OPERATOR_${index + 1}_EMAIL.`);
  if (!operator.password) fail(`Missing OPERATOR_${index + 1}_PASSWORD.`);
  if (operator.password.length < 8) {
    fail(`OPERATOR_${index + 1}_PASSWORD must be at least 8 characters.`);
  }
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

for (const operator of operators) {
  const email = operator.email.trim().toLowerCase();
  const existing = await findUserByEmail(email);

  if (existing) {
    const { error } = await supabase.auth.admin.updateUserById(existing.id, {
      email,
      password: operator.password,
      email_confirm: true,
      user_metadata: { email_verified: true },
    });
    if (error) fail(`Failed to update ${email}: ${error.message}`);
    console.log(`Updated ${email}`);
    continue;
  }

  const { error } = await supabase.auth.admin.createUser({
    email,
    password: operator.password,
    email_confirm: true,
    user_metadata: { email_verified: true },
  });
  if (error) fail(`Failed to create ${email}: ${error.message}`);
  console.log(`Created ${email}`);
}

console.log("Done.");

async function findUserByEmail(email) {
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) fail(`Failed to list Supabase users: ${error.message}`);

    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < perPage) return null;
    page += 1;
  }
}

function loadEnvFile(fileName) {
  const path = resolve(process.cwd(), fileName);
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    process.env[key] = stripQuotes(rawValue);
  }
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
