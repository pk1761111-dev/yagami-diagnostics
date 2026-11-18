# Free me online chalana (Render + Neon + cron-job.org)

Isme koi kharcha nahi lagega. Teen free services use hongi:

| Service | Kaam | Free limit |
|---|---|---|
| **Neon** (neon.com) | Database – saara data yahan rahega | 1 GB, hamesha free |
| **Render** (render.com) | App chalata hai, link deta hai | 750 ghante/mahina (1 app ke liye poora mahina) |
| **cron-job.org** | Har 10 min app ko jagata hai + 6 PM report chalata hai | free |

Payment ke screenshots database me hi save hote hain (Render free ki disk har restart pe saaf ho jaati hai). Phone se upload hone se pehle photo apne-aap chhoti ho jaati hai, isliye 1 GB me hazaaron proofs aa jayenge.

---

## Step 1 – Code GitHub pe
Code ek **private** GitHub repo `yagami-crm` me hona chahiye. Ye kaam Claude kar sakta hai: aap GitHub pe khaali private repo `yagami-crm` banao (README mat add karna), phir Claude ko bata do.

## Step 2 – Neon database (5 min)
1. neon.com → **Sign up** (Google se) → **New project**
2. Name `yagami-crm`, Region **Asia Pacific (Singapore)**, Postgres 16 → Create
3. **Connect** button → connection string copy karo. Wo kuch aisa dikhega:
   `postgresql://neondb_owner:xxxx@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`
   Ise sambhal ke rakho (ye password hai, kisi ko mat bhejna).

## Step 3 – Render pe app (10 min)
1. render.com → **Sign up with GitHub**
2. **New + → Blueprint** → `yagami-crm` repo choose karo → Render khud `render.yaml` padh lega
3. Wo 4 cheezein poochega:
   - `DATABASE_URL` → Neon wali string paste karo
   - `BOOTSTRAP_OWNER_NAME` → aapka naam
   - `BOOTSTRAP_OWNER_USERNAME` → jaise `owner`
   - `BOOTSTRAP_OWNER_PASSWORD` → koi temporary password (10+ akshar, letters + numbers)
4. **Apply** → 5–8 minute me build hoga. Upar link milega jaise `https://yagami-crm.onrender.com`
5. Render me service → **Environment** → `CRON_SECRET` ki value copy karo (Step 4 me lagegi)

## Step 4 – cron-job.org (5 min)
Free sign up karo, phir 3 cron jobs banao (Timezone: **Asia/Kolkata**):

| Title | URL | Schedule |
|---|---|---|
| Keep awake | `https://yagami-crm.onrender.com/api/health` | Every 10 minutes |
| Daily report | `https://yagami-crm.onrender.com/api/cron/run?key=CRON_SECRET_YAHAN` | Daily 18:05 |
| Morning reminders | `https://yagami-crm.onrender.com/api/cron/run?key=CRON_SECRET_YAHAN` | Daily 09:35 |

## Step 5 – Login aur team
1. Link kholo → Step 3 wala username/password → apna naya password set karo
2. **Team → Add staff** → 3 staff banao. Har ek ko temporary password milega (sirf ek baar dikhega)
3. Har phone me: Chrome → link kholo → ⋮ menu → **Add to Home screen**
4. Har phone pe ek baar 🔊 speaker icon dabao (alert sound ke liye)

## Backup (zaroori)
Free database ka apna lamba backup nahi hota. **Har hafte** Reports page → **Full data backup** dabao aur file Google Drive me rakh do.

## Free plan ki seemayein (sach)
- 10-min ping ke bawajood Render kabhi-kabhi restart karta hai – tab pehla page ~1 minute me khulega.
- Neon database 5 min koi kaam na ho to so jaata hai, agle click pe 1-2 second me jaag jaata hai.
- 1 GB database bharne lage ya app slow lage to Render Starter (~$7/mahina) le sakte ho – code wahi rahega.
