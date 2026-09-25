export interface PfdImagePageViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PfdImagePage {
  id: string;
  viewBox: PfdImagePageViewBox;
  imageWidth: number;
  imageHeight: number;
}

export function PfdImageLayer({ page, imageUrl }: { page: PfdImagePage; imageUrl: string }) {
  const { x, y, width, height } = page.viewBox;

  return (
    <svg
      className="pfd-image-layer"
      viewBox={`${x} ${y} ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-label={`${page.id} 原始 PFD 图像层`}
      role="img"
    >
      <image
        href={imageUrl}
        x="0"
        y="0"
        width={page.imageWidth}
        height={page.imageHeight}
        preserveAspectRatio="xMidYMid meet"
      />
    </svg>
  );
}
