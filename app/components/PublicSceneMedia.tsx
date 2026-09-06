/** Read-only scene/shot cover-photo renderer for the public "Szenenpreview"
 * page (#268). `imageUrl` is a `SceneOut.image_url`/`ShotOut.image_url` —
 * since the #248 image-to-R2 migration this is always already a full
 * presigned R2 URL (auth lives in the query string), so this can render it
 * directly with a plain <img> instead of fetching the bytes ourselves
 * through a share-link-authenticated proxy route the way this component
 * used to. */
export function PublicSceneMedia({
  imageUrl, className,
}: {
  imageUrl: string;
  className?: string;
}) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={imageUrl} alt="" className={className} />;
}
