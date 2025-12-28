# Movie Recommendation System

This is a full stack, immediately deployable application that hosts a backend, frontend, and PostgreSQL database server. 

The app is live at https://movies.qayyumayaan.dev/ so feel free to use it. 

Special thanks to The Movies Database (TMDB) and IMDB for the non-commercial use movie databases. 

## Development Log
(12/27/25): Added dark mode, minor text changes, improved backend cold start performance, and reduced costs. I also changed the movies that can be recommended to give more relevant recs. Thank you all for the feedback! Please continue to send more my way. 

(12/19/25): Version 1 of the site has been launched!

## About

There are three elements of this program: The backend, frontend, and PostgreSQL database. 

The goal of this program is to use vector similarity searches to recommend movies to users. The techniques in this project are training-free, except for the embedding model. 

The backend is written with Python and FastAPI. 

I provide the vector encoded movies in the `movies.tsv` file, but to encode it yourself, you will need to add your OpenAI API key in the empty template `cred.env` file in `./backend/cred.env`. You will need this to encode all text movies in the database. 

## Local Setup

In the frontend folder, please change `nginx.conf` to be exactly this: 

```
server {
    listen 8080;
    server_name _;

    root /usr/share/nginx/html;
    index login.html;

    location / {
        try_files $uri $uri/ /login.html;
    }

    location /api/ {
        proxy_pass http://backend:8000/;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # cookies + auth
        proxy_set_header Authorization $http_authorization;
        proxy_pass_request_headers on;
    }
}
```

Move `./backend/data/movies.tsv` to `./data/movies.tsv`. Create the folder if it doesn't exist. 

Compile all three Docker environments. Please cd into the project root folder and run:

```zsh
docker compose up
```

If the above doesn't work, try running this:
```zsh
docker compose down
docker compose build
docker compose up -d
```

## Detailed Gcloud Setup Instructions
Here is every single command that I used in order so you can replicate the results and deploy it on your own. 

#### Setup Backend
First, you must create the PostgreSQL database in the backend. 

```
gcloud sql instances create movies-db \
  --database-version=POSTGRES_16 \
  --edition=ENTERPRISE
  --tier=db-f1-micro
  --region=us-central1

gcloud sql databases create movies_db --instance=movies-db

gcloud sql users create postgres \
  --instance=movies-db \
  --password=<change-this-obviously>

gcloud sql connect movies-db --user=postgres
```
Once you are in the SQL terminal: 
```
-- Create app database (if not already created)
CREATE DATABASE movies_db;

\c movies_db

-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;
\dx
```
You should see something like this: 
```
                                       List of installed extensions
        Name        | Version |       Schema       |                     Description                      
--------------------+---------+--------------------+------------------------------------------------------
 google_vacuum_mgmt | val     | google_vacuum_mgmt | extension for assistive operational tooling
 plpgsql            | val     | pg_catalog         | PL/pgSQL procedural language
 vector             | val     | public             | vector data type and ivfflat and hnsw access methods
```


If you don't have psql installed, run these commands on Mac: 
```
brew install postgresql@16
brew link --force postgresql@16
psql --version
```


#### Deploy Backend

Please check if you have permissions: 
```
gcloud services enable run.googleapis.com \
  cloudbuild.googleapis.com \
  sqladmin.googleapis.com

```

Set region (central in my case):
```
gcloud config set run/region us-central1
```

Please note the name of the Cloud SQL instance connection name from this command: 
```
gcloud sql instances describe movies-db \
  --format="value(connectionName)"
```

You can connect at this point to the SQL database with this command:
```
gcloud sql connect movies-db --user=postgres
```

Update the env.yaml with values that matter to you. A template is provided in the right directory. Keep this file safe!

Then deploy the backend: 
```
gcloud run deploy movie-backend \
  --source ./backend \
  --region us-central1 \
  --allow-unauthenticated \
  --add-cloudsql-instances <your-project-name>:us-central1:movies-db \
  --env-vars-file backend/env.yaml \
  --port 8080
```

View current projects to fill in the above: 
```
gcloud projects list
```

After this command builds, check if the backend is running: 
```
gcloud run services describe movie-backend \
  --region us-central1 \
  --format="value(status.url)"
```

See why backend is not working: 
```
gcloud run revisions list \
  --service movie-backend \
  --region us-central1
```


#### Deploy Frontend

```
gcloud run deploy movie-frontend \
  --source ./frontend \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080
```

```
gcloud run services describe movie-frontend \
  --region us-central1 \
  --format="value(status.url)"
```



#### Set Up Load Balancer 
This makes authentication work properly. 

```
gcloud compute network-endpoint-groups create frontend-neg \
  --region=us-central1 \
  --network-endpoint-type=serverless \
  --cloud-run-service=movie-frontend

gcloud compute network-endpoint-groups create backend-neg \
  --region=us-central1 \
  --network-endpoint-type=serverless \
  --cloud-run-service=movie-backend

```

Create backend services.

```
gcloud compute backend-services create frontend-backend \
  --global

gcloud compute backend-services add-backend frontend-backend \
  --global \
  --network-endpoint-group=frontend-neg \
  --network-endpoint-group-region=us-central1

gcloud compute backend-services create backend-backend \
  --global

gcloud compute backend-services add-backend backend-backend \
  --global \
  --network-endpoint-group=backend-neg \
  --network-endpoint-group-region=us-central1

```

URL Map (path routing)
Swap your domain with the right one in variable `<insert-domain-here>`
```
gcloud compute url-maps create movies-url-map \
  --default-service=frontend-backend

gcloud compute url-maps add-path-matcher movies-url-map \
  --path-matcher-name=api \
  --default-service=frontend-backend \
  --backend-service-path-rules="/api/*=backend-backend" \
  --route-rules='
  priority=0,
  matchRules=prefixMatch:/api/,
  routeAction.urlRewrite.pathPrefixRewrite=/
  '

gcloud compute url-maps add-host-rule movies-url-map \
  --hosts=<insert-domain-here> \
  --path-matcher-name=api
```

Verify the URL map: 
```
gcloud compute url-maps describe movies-url-map
```

Create HTTPS certificate: 
```
gcloud compute ssl-certificates create movies-cert \
  --domains=<insert-domain-here> \
  --global
```

Check status of HTTPS certificate: 
```
gcloud compute ssl-certificates describe movies-cert \
  --global
```

It should say "MANAGED" or "PROVISIONING". Eventually it will say "status: ACTIVE". That's when you're good. 

Attach certificate to HTTPS proxy. 
```
gcloud compute target-https-proxies create movies-https-proxy \
  --url-map=movies-url-map \
  --ssl-certificates=movies-cert
```

On your custom domain site, you will need to add a new DNS rule like what I have to do on my site `qayyumayaan.dev`. You can get the IP as it is provisioning and get everything ready. The following commands use my site, but replace it with your own. 

Create a forwarding rule: 
```
gcloud compute forwarding-rules create movies-https-rule \
  --global \
  --target-https-proxy=movies-https-proxy \
  --ports=443
```

Find the IP with this command: 
```
gcloud compute forwarding-rules describe movies-https-rule \
  --global \
  --format="value(IPAddress)"
```

Confirm it exists with: 
```
gcloud compute forwarding-rules list --global
```

To add the DNS rule, I have to go to my domain provider and in my case I will set the following: 
```
HOST=movies
TYPE=A
TTL=30min
DATA=<LOAD_BALANCER_IP>
```

After the DNS activates and the SSL certificate moves from PROVISIONING to ACTIVE, confirm the DNS resolution with the following commands: 
```
dig <insert-domain-here> +short
```
This should return `<LOAD_BALANCER_IP>`

Check the certificate status: 
```
gcloud compute ssl-certificates describe movies-cert --global
```
Look for `status: ACTIVE`

Test the site with: 
```
curl -I https://movies.qayyumayaan.dev
```


To clean up and once everything works, you can increase the TTL to something higher like 4 hours or 1 day. This reduces DNS query load but is not required.


#### You're done!