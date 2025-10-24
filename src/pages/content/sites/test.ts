// // benchmark-youtube-id.ts
// function getByStringOps(url: string): string | null {
//   const idx = url.indexOf("v=");
//   if (idx === -1) return null;
//   const id = url.substring(idx + 2).split("&")[0];
//   return id || null;
// }

// function getByRegex(url: string): string | null {
//   const match = url.match(/[?&]v=([^&]+)/);
//   return match ? match[1] : null;
// }

// function getByURL(url: string): string | null {
//   try {
//     return new URL(url).searchParams.get("v");
//   } catch {
//     return null;
//   }
// }

// function getByIndexOf(url: string): boolean | null {
//   return url.indexOf("watch") !== -1;

// }

// function getByIncludes(url: string): boolean | null {
//   return url.includes("watch") ;

// }

// // Test setup
// const testUrl = "https://www.youtube.com/watch?v=zEv6YwyhMco";
// const iterations = 1_000_000;

// console.log("Testing extraction of ID from:", testUrl);
// console.log("Expected result: zEv6YwyhMco\n");

// console.time("String Ops");
// for (let i = 0; i < iterations; i++) getByStringOps(testUrl);
// console.timeEnd("String Ops");

// console.time("Regex");
// for (let i = 0; i < iterations; i++) getByRegex(testUrl);
// console.timeEnd("Regex");

// console.time("URL API");
// for (let i = 0; i < iterations; i++) getByURL(testUrl);
// console.timeEnd("URL API");

// console.time("IndexOf");
// for (let i = 0; i < iterations; i++) getByIndexOf(testUrl);
// console.timeEnd("IndexOf");

// console.time("Includes");
// for (let i = 0; i < iterations; i++) getByIncludes(testUrl);
// console.timeEnd("Includes");

// import isVideoPage from crunchyrolladapter
import { SiteAdapter } from "../interfaces/SiteAdapter";
import { CrunchyrollAdapter } from "./crunchyroll";

const adapter = new CrunchyrollAdapter();

const testUrls = [
    "https://www.crunchyroll.com/watch/GK9U31P9J/dog--chainsaw"
];
for (const url of testUrls) {
    console.log(`Testing URL: ${url}`);
    console.log(`isVideoPage: ${adapter.isVideoPage(url)}`);
    console.log(`getVideoId: ${adapter.getVideoId(url)}`);
    console.log('---');
}