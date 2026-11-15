import { TransactionBuilder } from "@stellar/stellar-sdk";
import { publicEnv } from "@/config/public-env";
import { AppError } from "./errors";

/** Hash of a transaction envelope. Signing does not change it, so the hash of the
 *  unsigned XDR we prepared must equal the hash of the signed XDR we are asked to submit. */
export function txHashOf(xdr: string, passphrase: string = publicEnv.networkPassphrase): string {
  try {
    return TransactionBuilder.fromXDR(xdr, passphrase).hash().toString("hex");
  } catch (cause) {
    throw new AppError("VALIDATION", "invalid transaction envelope", undefined, { cause });
  }
}
