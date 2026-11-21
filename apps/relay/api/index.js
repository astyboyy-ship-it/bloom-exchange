// Vercel entry: the compiled relay (npm run build -w @bloom-exchange/relay) as one Node.js function.
// vercel.json rewrites every path here; the original path and query reach the relay unchanged (it verifies
// request signatures over them).
import { vercelHandler } from "../dist/vercel.js";

export default vercelHandler();
