import os
import sys
from dotenv import load_dotenv
from care import create_app

load_dotenv()

# Security token for basic GET access
API_SECRET_TOKEN = os.environ.get('API_SECRET_TOKEN')

app = create_app({'START_WORKER': 'create-operator' not in sys.argv})

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=int(os.environ.get('PORT', '8000')), debug=False)
