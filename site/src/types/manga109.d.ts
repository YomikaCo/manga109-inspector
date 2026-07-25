/** Core annotation kinds defined by the Manga109 XML schema. */
export type Manga109AnnotationKind = "frame" | "text" | "face" | "body" | "onomatopoeia";

export interface Manga109BoundingBox {
  readonly xmin: number;
  readonly ymin: number;
  readonly xmax: number;
  readonly ymax: number;
}

export interface Manga109Point {
  readonly x: number;
  readonly y: number;
}

export interface Manga109BaseAnnotation extends Manga109BoundingBox {
  /** Dataset-wide eight-digit hexadecimal identifier. */
  readonly id: string;
  readonly kind: Manga109AnnotationKind;
  /** Position among annotation elements in the source page XML. */
  readonly sourceOrder: number;
}

export interface Manga109FrameAnnotation extends Manga109BaseAnnotation {
  readonly kind: "frame";
}

export interface Manga109TextAnnotation extends Manga109BaseAnnotation {
  readonly kind: "text";
  /** Exact text node content from the XML element. */
  readonly text: string;
}

export interface Manga109CharacterAnnotation extends Manga109BaseAnnotation {
  readonly kind: "face" | "body";
  /** References Manga109Character.id. */
  readonly characterId: string;
}

export interface Manga109OnomatopoeiaAnnotation extends Manga109BaseAnnotation {
  readonly kind: "onomatopoeia";
  /** Polygon vertices in source order. */
  readonly points: readonly Manga109Point[];
  /** Exact text node content from the XML element. */
  readonly text: string;
}

export type Manga109Annotation =
  | Manga109FrameAnnotation
  | Manga109TextAnnotation
  | Manga109CharacterAnnotation
  | Manga109OnomatopoeiaAnnotation;

export interface Manga109Character {
  readonly id: string;
  readonly name: string;
}

export type Manga109AnnotationsByKind = Readonly<{
  frame: readonly Manga109FrameAnnotation[];
  text: readonly Manga109TextAnnotation[];
  face: readonly Manga109CharacterAnnotation[];
  body: readonly Manga109CharacterAnnotation[];
  onomatopoeia: readonly Manga109OnomatopoeiaAnnotation[];
}>;

export interface Manga109OnomatopoeiaLink {
  readonly id: string;
  /** link0, link1, link2, … IDs referenced by this onomatopoeia link. */
  readonly ids: readonly string[];
  /** The XML tag name, e.g. "onomatopoeia_link1" or "onomatopoeia_link2". */
  readonly linkType: string;
}

export interface Manga109PageAnnotation {
  /** Index stored in the XML and normally represented by a zero-padded image filename. */
  readonly index: number;
  /** Annotation coordinate-space width. */
  readonly width: number;
  /** Annotation coordinate-space height. */
  readonly height: number;
  /** All objects in original XML child order. */
  readonly annotations: readonly Manga109Annotation[];
  readonly byKind: Manga109AnnotationsByKind;
  /** COO links between truncated onomatopoeia parts. */
  readonly links: readonly Manga109OnomatopoeiaLink[];
}

export interface Manga109BookAnnotation {
  readonly title: string;
  readonly characters: readonly Manga109Character[];
  readonly pages: readonly Manga109PageAnnotation[];
  readonly warnings: readonly string[];
}

export interface Manga109ImageAsset {
  readonly key: string;
  readonly name: string;
  readonly relativePath: string;
  readonly numericIndex: number | null;
  getFile(): Promise<File>;
}

export type Manga109ImageMappingMode = "numeric" | "ordinal" | "partial";

export interface Manga109MappedImages {
  readonly mode: Manga109ImageMappingMode;
  readonly pages: ReadonlyMap<number, Manga109ImageAsset>;
  readonly warnings: readonly string[];
}

export interface Manga109LoadedBook {
  readonly name: string;
  readonly annotation: Manga109BookAnnotation;
  readonly images: Manga109MappedImages;
  readonly charactersById: ReadonlyMap<string, Manga109Character>;
  readonly pagesByIndex: ReadonlyMap<number, Manga109PageAnnotation>;
}

export interface Manga109Dataset {
  readonly kind: "file-system-access" | "directory-input" | "fixture";
  readonly rootName: string;
  readonly annotationSetNames: readonly string[];
  readonly selectedAnnotationSet: string;
  /** Available onomatopoeia add-on sets; the first entry is always "" (none). */
  readonly onomatopoeiaSetNames: readonly string[];
  /** Selected onomatopoeia add-on set; "" means none. */
  readonly selectedOnomatopoeiaSet: string;
  readonly discoveryWarnings: readonly string[];

  setAnnotationSet(name: string, onomatopoeiaSet?: string): Promise<void>;
  listBooks(): readonly string[];
  loadBook(name: string): Promise<Manga109LoadedBook>;
  clearCaches(): void;
}

export interface Manga109LayerVisibility {
  readonly frame: boolean;
  readonly text: boolean;
  readonly face: boolean;
  readonly body: boolean;
}

export interface Manga109ImageDimensions {
  readonly width: number;
  readonly height: number;
}
