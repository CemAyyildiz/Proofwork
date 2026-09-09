import { currentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await currentUser();
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight">Human-verified bounties, settled on Stellar.</h1>
      <p className="text-neutral-600">
        A project funds a campaign into escrow. Contributors submit work. Every submission is reviewed against a written
        rubric, every decision is committed on-chain, approved contributors are paid in USDC, and the remainder returns
        to the funder.
      </p>
      {user ? (
        <p className="text-sm text-neutral-500">
          Signed in as <code>{user.pubkey}</code>
          {user.roles.size > 0 ? ` · roles: ${[...user.roles].join(", ")}` : " · no roles granted"}
        </p>
      ) : (
        <p className="text-sm text-neutral-500">Connect a Stellar testnet wallet to continue.</p>
      )}
    </div>
  );
}
