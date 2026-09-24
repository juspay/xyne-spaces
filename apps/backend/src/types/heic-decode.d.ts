declare module "heic-decode" {
	export interface DecodedHeicImage {
		width: number;
		height: number;
		/**
		 * RGBA pixel data (4 bytes per pixel), upright: libheif applies the
		 * irot/imir transform properties during decode.
		 */
		data: Uint8ClampedArray;
	}

	export interface HeicImageHandle {
		width: number;
		height: number;
		decode(): Promise<DecodedHeicImage>;
	}

	export interface HeicImageList extends Array<HeicImageHandle> {
		dispose(): void;
	}

	function decodeHeic(options: {
		buffer: Buffer | Uint8Array;
	}): Promise<DecodedHeicImage>;

	namespace decodeHeic {
		export function all(options: {
			buffer: Buffer | Uint8Array;
		}): Promise<HeicImageList>;
	}

	export = decodeHeic;
}
