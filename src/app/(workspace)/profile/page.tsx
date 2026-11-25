import type { Metadata } from "next";
import { ProfileForm, type CountryOption } from "@/components/profile-form";
import { SignedOut } from "@/components/signed-out";
import { PageHeader } from "@/components/workspace/page-header";
import { COUNTRY_CODES, safeNext } from "@/domain/profile";
import { currentUser } from "@/lib/current-user";
import { getOwnProfile } from "@/services/profile";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Your profile" };

/** Country names come from the server's ICU, so the browser hydrates the same text the server sent. */
function countryOptions(): CountryOption[] {
  const names = new Intl.DisplayNames(["en"], { type: "region", fallback: "code" });
  return COUNTRY_CODES.map((code) => ({ code, name: names.of(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name, "en"));
}

/**
 * The session wallet's profile. Reached from the wallet menu, or once after a
 * first sign-in with `?next=` naming the page to go back to.
 */
export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const user = await currentUser();
  if (!user) return <SignedOut />;
  const raw = (await searchParams).next;
  const next = typeof raw === "string" ? safeNext(raw) : null;
  const profile = await getOwnProfile(user.pubkey);
  const saved = profile?.displayName != null;

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Profile"
        title={saved ? "Your profile" : "Who is behind this wallet?"}
        description={
          <>
            Your name and bio go on a public page with your approved work and payouts. Telegram and city are only seen by you and the
            Proofwork operator, to reach you about your bounties. All of it is optional: nothing here is needed to submit, review or fund.
          </>
        }
      />
      <ProfileForm
        pubkey={user.pubkey}
        next={next}
        saved={saved}
        countries={countryOptions()}
        initial={{
          displayName: profile?.displayName ?? "",
          bio: profile?.bio ?? "",
          telegram: profile?.telegram ?? "",
          country: profile?.country ?? "",
          city: profile?.city ?? "",
        }}
      />
    </div>
  );
}
