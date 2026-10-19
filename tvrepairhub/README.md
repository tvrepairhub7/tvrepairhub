# TVREPAIRHUB – Website + Backend

## Run on your computer
1. Install Node.js (LTS) from https://nodejs.org
2. Open this folder in Terminal / Command Prompt
3. `npm install`
4. Copy `.env.example` to `.env` is optional; to set a password on Windows CMD: `set ADMIN_PASSWORD=YourStrongPass` then `npm start`
   (Mac/Linux: `ADMIN_PASSWORD=YourStrongPass npm start`)
5. Website: http://localhost:3000
6. Admin panel (all complaints): http://localhost:3000/admin  (username: anything, password: ADMIN_PASSWORD)

## Go live
Deploy the folder to Render.com / Railway (Node web service). Start command: `npm start`.
Set environment variables from `.env.example` in the dashboard.
Note: free hosts may reset the `data/` folder on restart; use a paid disk or a database for long-term storage.

## Pages
index, services, service?s=slug, brands, brand?b=name, about, contact (complaint form), track (status by ID + phone).
API: POST /api/complaints, GET /api/complaints/:id?phone=, GET /api/catalog, /sitemap.xml, /robots.txt. Edit services/brands in catalog.json.

Default admin password is Ayyan@8417. For the live site, set ADMIN_PASSWORD in Render to something private.

Admin login: username tvrepairhub (env ADMIN_USER), password from ADMIN_PASSWORD. Set both in Render for the live site.
