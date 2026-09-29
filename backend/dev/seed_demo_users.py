#!/usr/bin/env python3
"""
Multi-Tenant Demo Seeder — Task 13.4
Generates realistic isolated users and graph networks programmatically for WarmGraph.
"""

import sys
import random
from pathlib import Path
from datetime import datetime, timedelta

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from repositories.repository_provider import get_graph_repository

FIRST_NAMES = [
    "Sarah", "Alex", "Priya", "David", "Marcus", "Elena", "Rohan",
    "Maya", "Daniel", "Chloe", "Vikram", "Sophia", "Kavya", "Arjun",
    "Jessica", "Michael", "Anita", "Liam", "Zara", "Omar"
]

LAST_NAMES = [
    "Jenkins", "Rivera", "Sharma", "Chen", "Vance", "Kowalski", "Patel",
    "Lin", "O'Connor", "Gupta", "Nair", "Taylor", "Hegde", "Rao",
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Miller"
]

TITLES = [
    "Senior Software Engineer", "Director of Engineering", "VP of Product",
    "Head of Corporate Development", "Principal Architect", "Product Manager",
    "Data Scientist", "Associate Dean Placements", "Engineering Manager",
    "Staff SWE", "Consultant", "Managing Director", "CFO", "CTO"
]

COMPANIES = [
    "Global Academy of Technology", "Hewlett Packard Enterprise", "SISA",
    "Microsoft", "Google", "Amazon", "Meta", "Stripe", "Snowflake",
    "Goldman Sachs", "Databricks", "Uber", "Airbnb", "Tesla", "Salesforce"
]


def seed_demo_users(count: int = 5) -> list[dict]:
    """
    Generate realistic, isolated demo users programmatically.
    Each user receives 80-300 connections, companies, and relationship edges.
    """
    repository = get_graph_repository()
    created_users = []

    for i in range(1, count + 1):
        user_id = f"demo_user_{i}"
        fname = random.choice(FIRST_NAMES)
        lname = random.choice(LAST_NAMES)
        full_name = f"{fname} {lname}"
        email = f"{fname.lower()}.{lname.lower()}{i}@warmgraph.dev"

        # Generate 80 - 300 connections
        num_connections = random.randint(80, 300)
        connections = []

        for j in range(1, num_connections + 1):
            c_fname = random.choice(FIRST_NAMES)
            c_lname = random.choice(LAST_NAMES)
            c_name = f"{c_fname} {c_lname}"
            c_company = random.choice(COMPANIES)
            c_title = random.choice(TITLES)
            c_profile = f"https://www.linkedin.com/in/{c_fname.lower()}-{c_lname.lower()}-{random.randint(1000,9999)}"

            connections.append({
                "name": c_name,
                "headline": f"{c_title} at {c_company}",
                "company": c_company,
                "profile_url": c_profile,
                "degree": "1st",
                "connection_date": (datetime.utcnow() - timedelta(days=random.randint(1, 300))).strftime("%b %d, %Y"),
                "source": "linkedin_dom",
                "confidence": 1.0
            })

        # Generate relationship evidence / 2nd degree edges
        num_evidence = random.randint(8, 25)
        evidence = []
        for k in range(1, num_evidence + 1):
            e_fname = random.choice(FIRST_NAMES)
            e_lname = random.choice(LAST_NAMES)
            e_name = f"{e_fname} {e_lname}"
            e_company = random.choice(COMPANIES)
            e_title = random.choice(TITLES)
            e_profile = f"https://www.linkedin.com/in/{e_fname.lower()}-{e_lname.lower()}-{random.randint(1000,9999)}"

            evidence.append({
                "name": e_name,
                "headline": f"{e_title} at {e_company}",
                "company": e_company,
                "profile_url": e_profile,
                "observed_degree": "2nd",
                "evidence_type": "mutual_connection_ui",
                "source": "linkedin_dom",
                "mutual_connection_names": [connections[random.randint(0, len(connections) - 1)]["name"]]
            })

        sync_date = (datetime.utcnow() - timedelta(hours=random.randint(2, 48))).strftime("%b %d, %Y")

        network_data = {
            "owner_id": user_id,
            "source": "linkedin_dom",
            "connection_count": len(connections),
            "connections": connections,
            "relationship_evidence_count": len(evidence),
            "relationship_evidence": evidence,
            "last_synced_at": sync_date
        }

        # Save isolated network file
        repository.save_network(user_id, network_data)

        # Create user record in users.json
        user_record = repository.create_user({
            "id": user_id,
            "name": full_name,
            "email": email,
            "avatar": "",
            "provider": "local",
            "created_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "last_sync": sync_date
        })

        created_users.append(user_record)
        print(f"Seeded {user_id} ({full_name}): {len(connections)} connections, {len(evidence)} evidences.")

    return created_users


if __name__ == "__main__":
    count_to_seed = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    seed_demo_users(count_to_seed)
    print("\nDemo users seeded successfully!")
