CREATE TABLE "session_revocation" (
	"pubkey" text PRIMARY KEY NOT NULL,
	"revoked_before" timestamp with time zone NOT NULL
);
