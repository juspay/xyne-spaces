import tailwindcss from '@tailwindcss/postcss';
import { vendorLayer } from '../dashboard/postcss.config.js';

export default {
  plugins: [tailwindcss, vendorLayer],
};
