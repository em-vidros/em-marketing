CREATE TABLE "movimentos_do_saldo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" text NOT NULL,
	"valor" double precision NOT NULL,
	"por" text NOT NULL,
	"em" timestamp with time zone DEFAULT now() NOT NULL,
	"removido_em" timestamp with time zone
);
