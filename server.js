import express from 'express';
import cors from 'cors';
import Stripe from 'stripe';

const app = express();
app.use(cors());
app.use(express.json());

// Log básico de solicitudes entrantes
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Endpoint de salud para verificar conectividad
app.get('/health', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// Puente de redirección HTTPS -> App Scheme/Expo (evita bloqueo de Stripe con esquemas no https)
app.get('/return', (req, res) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : 'unknown';
    const to = typeof req.query.to === 'string' ? req.query.to : '';
    // Asegurar que existe URL destino
    if (!to) return res.status(400).send('Missing to');
    // Construir URL final hacia la app (añadir status si no viene)
    const hasQuery = to.includes('?');
    const finalUrl = `${to}${hasQuery ? '&' : '?'}status=${encodeURIComponent(status)}`;
    // HTML con redirección inmediata y fallback link
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8" />
      <meta http-equiv="refresh" content="0;url='${finalUrl}'" />
      <title>Volviendo a la app…</title>
      <script>window.location.replace('${finalUrl}');</script>
    </head><body>
      <p>Redirigiendo… Si no ocurre automáticamente, <a href="${finalUrl}">toca aquí</a>.</p>
    </body></html>`);
  } catch {
    res.status(500).send('Redirect error');
  }
});

// Instancia Stripe con tu clave secreta (del .env)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

// Validación simple del importe en céntimos
function validateAmount(amount) {
  return Number.isInteger(amount) && amount > 0 && amount < 1_000_000;
}

app.post('/api/stripe/create-checkout-session', async (req, res) => {
  try {
    const { amount, currency = 'eur', email, bloque, returnUrl } = req.body || {};
    if (!validateAmount(amount)) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    // Descubrir base pública (ngrok) desde cabeceras para construir URLs https
    const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString();
    const proto = (req.headers['x-forwarded-proto'] || 'http').toString();
    const publicBase = `${proto}://${host}`;
    // Usar returnUrl del cliente (exp:// o scheme://) como destino final de /return
    const baseReturn = typeof returnUrl === 'string' && returnUrl.length > 0
      ? returnUrl
      : 'academiadeinmigrantes://checkout';
    const successUrl = `${publicBase}/return?status=success&to=${encodeURIComponent(baseReturn)}`;
    const cancelUrl  = `${publicBase}/return?status=cancel&to=${encodeURIComponent(baseReturn)}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: (bloque || '').toUpperCase() === 'B1B2' ? 'Matrícula B1/B2' : 'Matrícula A1/A2',
            },
            unit_amount: amount, // céntimos
          },
          quantity: 1,
        },
      ],
      customer_email: email,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { bloque: String(bloque || '') },
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    return res.status(500).json({ error: 'Unable to create session' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Stripe server running on ${PORT}`));