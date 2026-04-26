To run a db migration:
`bunx sst shell bun run db:migrate`

To reset the db
`bunx sst shell bun run db:reset`

To run a db seed:
`bunx sst shell bun run db:seed`

To start dev environment:
`bunx sst dev`

To run tests locally:
`bunx sst shell -- bun test`

To update a customer: 
`https://nvrt6uv3caioemxhcqxtczzjni0ptvsj.lambda-url.eu-north-1.on.aws/v1/users/user_001`
`Headers: x-customer-id: 00000000-0000-0000-0000-000000000001`
`Body:
  {
    "attributes": {
        "plan": "standard",
        "signup_source": "organic",
        "lifetime_value": 10.00,
        "is_verified": true
    }
  }
`

To run the enrollment endpoint:
`https://qlicj667lze3el7l65tqpbhmsy0adrmr.lambda-url.eu-north-1.on.aws/enrollments/process`
