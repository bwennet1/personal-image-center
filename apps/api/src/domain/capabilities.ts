export type SpaceRole = "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";

export type Capability =
  | "view_media"
  | "upload_media"
  | "edit_media"
  | "delete_media"
  | "purge_original"
  | "download_optimized"
  | "download_original"
  | "create_album"
  | "create_slideshow"
  | "create_presentation"
  | "create_share"
  | "create_folder"
  | "manage_members"
  | "invite_member"
  | "manage_roles"
  | "manage_storage"
  | "delete_space"
  | "transfer_ownership"
  | "view_audit"
  | "use_ai";

const ALL: Capability[] = [
  "view_media",
  "upload_media",
  "edit_media",
  "delete_media",
  "purge_original",
  "download_optimized",
  "download_original",
  "create_album",
  "create_slideshow",
  "create_presentation",
  "create_share",
  "create_folder",
  "manage_members",
  "invite_member",
  "manage_roles",
  "manage_storage",
  "delete_space",
  "transfer_ownership",
  "view_audit",
  "use_ai",
];

const OWNER = new Set<Capability>(ALL);

const ADMIN = new Set<Capability>(
  ALL.filter((c) => c !== "delete_space" && c !== "transfer_ownership"),
);

const EDITOR = new Set<Capability>([
  "view_media",
  "upload_media",
  "edit_media",
  "delete_media",
  "download_optimized",
  "download_original",
  "create_album",
  "create_slideshow",
  "create_presentation",
  "create_share",
  "create_folder",
  "use_ai",
]);

const VIEWER = new Set<Capability>(["view_media", "download_optimized"]);

const ROLE_CAPS: Record<SpaceRole, Set<Capability>> = {
  OWNER,
  ADMIN,
  EDITOR,
  VIEWER,
};

export function capabilitiesFor(role: SpaceRole): Capability[] {
  return [...ROLE_CAPS[role]];
}

export function hasCapability(role: SpaceRole, capability: Capability): boolean {
  return ROLE_CAPS[role]?.has(capability) === true;
}
