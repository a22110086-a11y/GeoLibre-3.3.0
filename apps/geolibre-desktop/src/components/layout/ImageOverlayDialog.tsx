import { useCallback, useEffect, useState } from "react";
import type { MapEngine } from "@geolibre/map";
import { useAppStore } from "@geolibre/core";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Slider,
} from "@geolibre/ui";
import { ImagePlus, MapPin, RotateCcw, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { releaseBodyPointerEvents } from "../../lib/radix-compat";

interface ImageOverlayDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mapControllerRef: React.RefObject<MapEngine | null>;
}

interface OverlayImage {
  url: string;
  name: string;
  width: number;
  height: number;
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function rotateCorners(
  center: [number, number],
  width: number,
  height: number,
  bearing: number,
): [number, number][] {
  const [cx, cy] = center;
  const rad = (bearing * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const halfW = width / 2;
  const halfH = height / 2;
  const points: [number, number][] = [
    [-halfW, halfH],
    [halfW, halfH],
    [halfW, -halfH],
    [-halfW, -halfH],
  ];
  return points.map(([x, y]) => [cx + x * cos - y * sin, cy + x * sin + y * cos]);
}

function boundsFromCorners(corners: [number, number][]): [number, number, number, number] {
  const lngs = corners.map((c) => c[0]);
  const lats = corners.map((c) => c[1]);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

function readNumber(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function ImageOverlayDialog({
  open,
  onOpenChange,
  mapControllerRef,
  mapReadyGeneration = 0,
}: ImageOverlayDialogProps) {
  const { t } = useTranslation();
  const addImageOverlayLayer = useAppStore((s) => s.addImageOverlayLayer);
  const [image, setImage] = useState<OverlayImage | null>(null);
  const [name, setName] = useState("");
  const [longitude, setLongitude] = useState("0");
  const [latitude, setLatitude] = useState("0");
  const [width, setWidth] = useState("20");
  const [height, setHeight] = useState("10");
  const [rotation, setRotation] = useState("0");
  const [opacity, setOpacity] = useState(0.75);
  const [placing, setPlacing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const resetFromView = useCallback(() => {
    const engine = mapControllerRef.current;
    if (!engine) return;
    const view = engine.readView();
    setLongitude(String(Number(view.center[0].toFixed(6))));
    setLatitude(String(Number(view.center[1].toFixed(6))));
    const bounds = engine.getViewBounds();
    if (bounds) {
      const viewWidth = Math.max(0.1, Math.min(180, Math.abs(bounds[2] - bounds[0]) * 0.5));
      const viewHeight = Math.max(0.1, Math.min(90, Math.abs(bounds[3] - bounds[1]) * 0.5));
      setWidth(String(Number(viewWidth.toFixed(4))));
      setHeight(String(Number(viewHeight.toFixed(4))));
    }
  }, [mapControllerRef]);

  useEffect(() => {
    if (!open) return;
    resetFromView();
    setNotice(null);
  }, [open, resetFromView]);

  const handleImageFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      setNotice(t("imageOverlay.imageTooLarge", { max: "8 MB" }));
      return;
    }
    if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) {
      setNotice(t("imageOverlay.unsupportedFormat"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setNotice(t("imageOverlay.readError"));
    reader.onload = () => {
      const url = typeof reader.result === "string" ? reader.result : "";
      if (!url) {
        setNotice(t("imageOverlay.readError"));
        return;
      }
      const probe = new Image();
      probe.onload = () => {
        setImage({
          url,
          name: file.name.replace(/\.[^.]+$/, ""),
          width: probe.naturalWidth,
          height: probe.naturalHeight,
        });
        setName(file.name.replace(/\.[^.]+$/, ""));
        setNotice(null);
      };
      probe.onerror = () => setNotice(t("imageOverlay.readError"));
      probe.src = url;
    };
    reader.readAsDataURL(file);
  }, [t]);

  const startPlacement = useCallback(() => {
    const engine = mapControllerRef.current;
    const surface = engine?.getRenderSurface();
    if (!engine || !surface) return;
    releaseBodyPointerEvents();
    const raf = requestAnimationFrame(releaseBodyPointerEvents);
    setPlacing(true);
    onOpenChange(false);
    const canvas = surface.getCanvas();
    const previousCursor = canvas?.style.cursor ?? "";
    if (canvas) canvas.style.cursor = "crosshair";
    let stopClick = () => {};
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") finish();
    };
    const finish = () => {
      stopClick();
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
      if (canvas) canvas.style.cursor = previousCursor;
      setPlacing(false);
      onOpenChange(true);
    };
    const onClick = ([lng, lat]: [number, number]) => {
      setLongitude(String(Number(lng.toFixed(6))));
      setLatitude(String(Number(lat.toFixed(6))));
      finish();
    };
    stopClick = engine.onMapClick(onClick);
    window.addEventListener("keydown", onKey);
  }, [mapControllerRef, onOpenChange]);

  const handleAdd = useCallback(() => {
    if (!image) {
      setNotice(t("imageOverlay.chooseImage"));
      return;
    }
    const center: [number, number] = [readNumber(longitude, 0), readNumber(latitude, 0)];
    const w = Math.abs(readNumber(width, 0));
    const h = Math.abs(readNumber(height, 0));
    const angle = readNumber(rotation, 0);
    if (center[0] < -180 || center[0] > 180 || center[1] < -90 || center[1] > 90 || w <= 0 || h <= 0) {
      setNotice(t("imageOverlay.invalidPlacement"));
      return;
    }
    const coordinates = rotateCorners(center, w, h, angle);
    if (coordinates.some(([, lat]) => lat < -90 || lat > 90)) {
      setNotice(t("imageOverlay.invalidLatitude"));
      return;
    }
    const bounds = boundsFromCorners(coordinates);
    addImageOverlayLayer(name.trim() || image.name || t("imageOverlay.defaultName"), {
      url: image.url,
      coordinates,
    }, {
      opacity,
      bounds,
      sourceKind: "image-overlay",
      metadata: {
        imageOverlay: {
          center,
          width: w,
          height: h,
          rotation: angle,
          originalWidth: image.width,
          originalHeight: image.height,
        },
      },
    });
    onOpenChange(false);
  }, [addImageOverlayLayer, height, image, latitude, longitude, name, onOpenChange, opacity, rotation, t, width]);

  if (placing) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImagePlus className="h-5 w-5" />
            {t("imageOverlay.title")}
          </DialogTitle>
          <DialogDescription>{t("imageOverlay.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <label className="cursor-pointer">
                <Upload className="me-2 h-4 w-4" />
                {t("imageOverlay.chooseImage")}
                <input className="hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleImageFile} />
              </label>
            </Button>
            {image ? (
              <span className="min-w-0 truncate text-sm text-muted-foreground">
                {image.name} · {image.width} × {image.height}
              </span>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label htmlFor="image-overlay-name">{t("imageOverlay.name")}</Label>
              <Input id="image-overlay-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("imageOverlay.namePlaceholder")} />
            </div>
            <div>
              <Label htmlFor="image-overlay-lon">{t("imageOverlay.longitude")}</Label>
              <Input id="image-overlay-lon" type="number" step="0.000001" value={longitude} onChange={(e) => setLongitude(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="image-overlay-lat">{t("imageOverlay.latitude")}</Label>
              <Input id="image-overlay-lat" type="number" step="0.000001" value={latitude} onChange={(e) => setLatitude(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="image-overlay-width">{t("imageOverlay.width")}</Label>
              <Input id="image-overlay-width" type="number" min="0.0001" step="0.1" value={width} onChange={(e) => setWidth(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="image-overlay-height">{t("imageOverlay.height")}</Label>
              <Input id="image-overlay-height" type="number" min="0.0001" step="0.1" value={height} onChange={(e) => setHeight(e.target.value)} />
            </div>
            <div className="col-span-2">
              <Label htmlFor="image-overlay-rotation">{t("imageOverlay.rotation")}</Label>
              <Input id="image-overlay-rotation" type="number" step="1" value={rotation} onChange={(e) => setRotation(e.target.value)} />
            </div>
          </div>

          <div className="rounded-md border p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <Label>{t("imageOverlay.opacity")}</Label>
              <span className="text-sm tabular-nums text-muted-foreground">{Math.round(opacity * 100)}%</span>
            </div>
            <Slider value={[opacity]} min={0} max={1} step={0.01} onValueChange={(v) => setOpacity(v[0] ?? opacity)} />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={startPlacement}>
              <MapPin className="me-2 h-4 w-4" />
              {t("imageOverlay.pickOnMap")}
            </Button>
            <Button type="button" variant="ghost" onClick={resetFromView}>
              <RotateCcw className="me-2 h-4 w-4" />
              {t("imageOverlay.useCurrentView")}
            </Button>
          </div>

          {notice ? <p className="text-sm text-destructive">{notice}</p> : null}
          <p className="text-xs text-muted-foreground">{t("imageOverlay.coordinateHint")}</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button onClick={handleAdd} disabled={!image}>{t("imageOverlay.add")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
