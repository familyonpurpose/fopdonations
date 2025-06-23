// api/webhook.js
import { buffer } from 'micro';
import Stripe from 'stripe';
import axios from 'axios';

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2022-11-15',
});

export default async function handler(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // Get the raw body for signature verification
    const buf = await buffer(req);
    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('⚠️ Webhook signature mismatch.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Only handle successful checkouts
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    let amountCents;

    if (session.mode === 'subscription') {
      const subscription = await stripe.subscriptions.retrieve(
        session.subscription,
        { expand: ['items.data.price'] }
      );
      amountCents = subscription.items.data[0].price.unit_amount;
    } else {
      amountCents = session.amount_total;
    }

    const email = session.customer_details.email;
    const title = session.mode === 'subscription'
      ? 'Monthly Gift Subscription'
      : 'One-Time Gift';

    // Create a dummy order in Kajabi
    try {
      await axios.post(
        'https://api.kajabi.com/api/v1/orders',
        {
          order: {
            site_id:      process.env.KAJABI_SITE_ID,
            email:        email,
            total_price:  (amountCents / 100).toFixed(2),
            currency:     'USD',
            product_title: title,
          },
        },
        {
          headers: {
            'Content-Type':  'application/json',
            Authorization:   `Bearer ${process.env.KAJABI_API_KEY}`,
          },
        }
      );
      console.log(`✅ Created Kajabi order for ${email}`);
    } catch (kajabiErr) {
      console.error('❌ Kajabi order error:', kajabiErr.response?.data || kajabiErr.message);
    }
  }

  res.status(200).send('OK');
}
