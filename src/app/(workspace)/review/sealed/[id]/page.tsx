import { notFound } from "next/navigation";
import { SealedReviewWorkspace } from "@/components/sealed-review-workspace";
import { SignedOut } from "@/components/signed-out";
import { PageHeader } from "@/components/workspace/page-header";
import { sealedDualReviewEnabled } from "@/config/env";
import { currentUser } from "@/lib/current-user";
import { sealedReviewView } from "@/services/sealed-review";

export const dynamic = "force-dynamic";

export default async function SealedReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!sealedDualReviewEnabled()) notFound();
  const user = await currentUser();
  if (!user) return <SignedOut />;
  const view = await sealedReviewView((await params).id, user);
  return (
    <div className="space-y-8 pb-24">
      <PageHeader eyebrow="Sub Rosa · testnet" title="Sealed dual review" description="ReceiptOnly mode. Zero escrow. Reviewer wallets sign their own Soroban transactions." />
      <SealedReviewWorkspace view={view} address={user.pubkey} />
    </div>
  );
}
