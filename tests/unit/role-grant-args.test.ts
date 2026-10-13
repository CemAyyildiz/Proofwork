import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { databaseTarget, parseRoleGrantArgs } from "@/domain/role-grant-args";

const WALLET = Keypair.random().publicKey();

function refusal(argv: string[]): string {
  const res = parseRoleGrantArgs(argv);
  if (res.ok) throw new Error(`accepted ${argv.join(" ")}`);
  return res.message;
}

describe("parseRoleGrantArgs", () => {
  it.each(["funder", "reviewer", "ops"] as const)("wallet and %s is a grant of that role", (role) => {
    expect(parseRoleGrantArgs([WALLET, role])).toEqual({ ok: true, args: { pubkey: WALLET, role, action: "grant" } });
  });

  it("--revoke after the role is a revocation of that role", () => {
    expect(parseRoleGrantArgs([WALLET, "reviewer", "--revoke"])).toEqual({ ok: true, args: { pubkey: WALLET, role: "reviewer", action: "revoke" } });
  });

  it("ignores the leading -- that pnpm may pass", () => {
    expect(parseRoleGrantArgs(["--", WALLET, "ops", "--revoke"])).toEqual({ ok: true, args: { pubkey: WALLET, role: "ops", action: "revoke" } });
  });

  it("refuses a key that is not a Stellar public key", () => {
    for (const key of ["GNOTAKEY", `${WALLET.slice(0, -1)}`, Keypair.random().secret().replace(/^S/, "X"), ""]) {
      expect(refusal([key, "funder"])).toContain("not a Stellar public key");
    }
  });

  it("refuses a missing key or role", () => {
    expect(refusal([])).toContain("wallet public key is required");
    expect(refusal([WALLET])).toContain("role must be funder, reviewer or ops");
  });

  it("refuses an unknown role", () => {
    for (const role of ["admin", "Funder", "funder,ops", "--revoke"]) expect(refusal([WALLET, role])).toContain("role must be funder, reviewer or ops");
  });

  it("refuses an unknown flag instead of treating it as a grant or a revoke", () => {
    for (const flag of ["--remove", "revoke", "--revoke=all", "-r"]) expect(refusal([WALLET, "funder", flag])).toContain("the only flag is --revoke");
  });

  it("refuses an extra argument", () => {
    expect(refusal([WALLET, "funder", "--revoke", "reviewer"])).toContain("at most three arguments");
    expect(refusal([WALLET, "funder", "reviewer", "--revoke"])).toContain("at most three arguments");
  });

  it("puts --revoke nowhere but last", () => {
    expect(refusal(["--revoke", WALLET, "funder"])).toContain("not a Stellar public key");
  });
});

describe("databaseTarget", () => {
  it("names the host and database and nothing that could log in", () => {
    // Assembled from parts so the repository holds no line that reads as credentials in a URL.
    const login = ["app_user", "made-up-for-this-test"];
    const target = databaseTarget("postgresql://" + login.join(":") + "@ep-cool-name-123.eu-central-1.aws.neon.tech/proofwork?sslmode=require&options=x");
    expect(target).toBe("ep-cool-name-123.eu-central-1.aws.neon.tech/proofwork");
    for (const part of login) expect(target).not.toContain(part);
    expect(target).not.toContain("sslmode");
  });

  it("keeps a non-default port", () => {
    expect(databaseTarget("postgres://pw@127.0.0.1:54329/scratch")).toBe("127.0.0.1:54329/scratch");
  });
});
