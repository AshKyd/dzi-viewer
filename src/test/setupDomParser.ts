import { DOMParser } from '@xmldom/xmldom';

// Node has no `DOMParser`; DZI XML parsing relies on the browser's, so unit tests use xmldom's instead.
if (typeof globalThis.DOMParser === 'undefined') {
	globalThis.DOMParser = DOMParser as unknown as typeof globalThis.DOMParser;
}
