// Marka ve API adresi. EXPO_PUBLIC_API_URL ile override edilebilir.
// Varsayilan: canli Render backend'i (telefonda hemen calisir).
export const BRAND_NAME = "Kernel";
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "https://kernel-backend-40le.onrender.com";
