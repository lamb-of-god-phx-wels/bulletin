import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { coverFocalCrop } from "./interactions.js";

export interface CoverFocalImageProps {
  readonly source: string;
  readonly alt: string;
  readonly focalX: number;
  readonly focalY: number;
  readonly className?: string | undefined;
  readonly imageClassName?: string | undefined;
  readonly style?: CSSProperties | undefined;
}

/** Exact visual counterpart of the generator's canonical focal-cover formula. */
export function CoverFocalImage({
  source,
  alt,
  focalX,
  focalY,
  className,
  imageClassName,
  style,
}: CoverFocalImageProps) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [crop, setCrop] = useState<ReturnType<typeof coverFocalCrop>>();

  function measure(): void {
    const host = hostRef.current;
    const image = imageRef.current;
    if (host === null || image === null || !image.complete) return;
    const next = coverFocalCrop({
      sourceWidth: image.naturalWidth,
      sourceHeight: image.naturalHeight,
      targetWidth: host.clientWidth,
      targetHeight: host.clientHeight,
      focalX,
      focalY,
    });
    setCrop((current) =>
      current?.renderedWidth === next?.renderedWidth &&
      current?.renderedHeight === next?.renderedHeight &&
      current?.originX === next?.originX &&
      current?.originY === next?.originY
        ? current
        : next
    );
  }

  useLayoutEffect(() => {
    setCrop(undefined);
    measure();
    const host = hostRef.current;
    if (host === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [focalX, focalY, source]);

  return (
    <span
      ref={hostRef}
      className={className}
      style={{
        position: "relative",
        display: "block",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        ...style,
      }}
    >
      <img
        ref={imageRef}
        className={imageClassName}
        src={source}
        alt={alt}
        onLoad={measure}
        style={crop === undefined
          ? { position: "absolute", opacity: 0 }
          : {
              position: "absolute",
              opacity: 1,
              maxWidth: "none",
              minHeight: 0,
              left: -crop.originX,
              top: -crop.originY,
              width: crop.renderedWidth,
              height: crop.renderedHeight,
              objectFit: "fill",
            }}
      />
    </span>
  );
}
