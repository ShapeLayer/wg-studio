import { newPeer, splitList } from "./wireguard.ts";
import type { ConfigModel, ConfigSection } from "./types.ts";

/** Build a peer for the remote interface without guessing a public Endpoint. */
export function peerForInterface(
  remote: ConfigModel,
  publicKey: string,
): ConfigSection {
  const peer = newPeer();
  peer.fields.find((field) => field.key === "PublicKey")!.value = publicKey;
  const iface = remote.sections.find((section) => section.type === "Interface");
  peer.fields.find((field) => field.key === "AllowedIPs")!.value = (
    iface?.fields || []
  )
    .filter((field) => field.key === "Address")
    .flatMap((field) => splitList(field.value || ""))
    .map((cidr) => {
      const ip = cidr.split("/")[0];
      return `${ip}/${ip.includes(":") ? "128" : "32"}`;
    })
    .join(", ");
  peer.fields = peer.fields.filter((field) => field.key !== "Endpoint");
  return peer;
}
