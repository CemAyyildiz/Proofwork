CREATE TABLE "x_account" (
	"pubkey" text PRIMARY KEY NOT NULL,
	"x_user_id" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "x_account_x_user_id_unique" UNIQUE("x_user_id")
);
