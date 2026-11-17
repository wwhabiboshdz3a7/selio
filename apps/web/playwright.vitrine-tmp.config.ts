import base from "./playwright.config";
export default { ...base, webServer: undefined, use: { ...base.use, baseURL: "http://127.0.0.1:4191" }, reporter: [["line"]] };
