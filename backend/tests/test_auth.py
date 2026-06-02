"""Auth flow: signup -> login -> protected route -> refresh."""


def _signup(client, email="alice@example.com", pw="supersecret1"):
    return client.post("/auth/signup", json={"email": email, "password": pw})


def test_signup_returns_tokens(client):
    r = _signup(client)
    assert r.status_code == 201
    body = r.json()
    assert body["access_token"] and body["refresh_token"]
    assert body["token_type"] == "bearer"


def test_duplicate_signup_conflicts(client):
    _signup(client)
    r = _signup(client)
    assert r.status_code == 409


def test_login_and_me(client):
    _signup(client, email="bob@example.com", pw="hunter2hunter")
    r = client.post(
        "/auth/login", json={"email": "bob@example.com", "password": "hunter2hunter"}
    )
    assert r.status_code == 200
    token = r.json()["access_token"]

    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["email"] == "bob@example.com"


def test_login_wrong_password(client):
    _signup(client, email="carol@example.com", pw="correcthorse")
    r = client.post(
        "/auth/login", json={"email": "carol@example.com", "password": "wrongwrong"}
    )
    assert r.status_code == 401


def test_login_unknown_user(client):
    r = client.post(
        "/auth/login", json={"email": "ghost@example.com", "password": "whatever1"}
    )
    assert r.status_code == 401


def test_me_requires_token(client):
    assert client.get("/auth/me").status_code == 401  # no bearer -> unauthenticated


def test_refresh_issues_new_access(client):
    refresh = _signup(client, email="dave@example.com").json()["refresh_token"]
    r = client.post("/auth/refresh", json={"refresh_token": refresh})
    assert r.status_code == 200
    assert r.json()["access_token"]


def test_access_token_rejected_as_refresh(client):
    access = _signup(client, email="erin@example.com").json()["access_token"]
    r = client.post("/auth/refresh", json={"refresh_token": access})
    assert r.status_code == 401  # wrong token type
