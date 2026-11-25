CREATE TABLE "profile" (
	"pubkey" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"bio" text,
	"telegram" text,
	"country" text,
	"city" text,
	"prompted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
