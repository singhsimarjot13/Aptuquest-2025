from flask import Flask, redirect, url_for, session, render_template, request, flash, jsonify, abort
from flask_dance.contrib.google import make_google_blueprint, google
from flask_sqlalchemy import SQLAlchemy
from flask_session import Session
import random
import logging
from datetime import datetime, timedelta
from flask_mail import Message, Mail
from threading import Thread
import os
from datetime import timedelta
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Configuration
app.config.update(
    SECRET_KEY=os.getenv('SECRET_KEY'),
    SESSION_TYPE="filesystem",
    SQLALCHEMY_DATABASE_URI=os.getenv('SQLALCHEMY_DATABASE_URI'),
    SQLALCHEMY_TRACK_MODIFICATIONS=False,
    MAIL_SERVER=os.getenv('MAIL_SERVER'),
    MAIL_PORT=587,
    MAIL_USE_TLS=True,
    MAIL_USERNAME=os.getenv('MAIL_USERNAME'),
    MAIL_PASSWORD=os.getenv('MAIL_PASSWORD'),
    MAIL_DEFAULT_SENDER=os.getenv('MAIL_DEFAULT_SENDER')
)


app.config['SESSION_PERMANENT'] = True             # Make sessions permanent
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(minutes=5)  # 5 min inactivity

# Initialize extensions
Session(app)
db = SQLAlchemy(app)
mail = Mail(app)

# Google OAuth Configuration
google_bp = make_google_blueprint(
    client_id=os.getenv('GOOGLE_CLIENT_ID'),
    client_secret=os.getenv('GOOGLE_CLIENT_SECRET'),
    scope=[
        "openid",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile"
    ],
    redirect_to="google_login"
)
app.register_blueprint(google_bp, url_prefix="/login")

# Database Model
class Participant(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    google_id = db.Column(db.String(150), unique=True)
    name = db.Column(db.String(150))
    email = db.Column(db.String(150), unique=True)
    profile_pic = db.Column(db.String(300))
    urn = db.Column(db.String(50), nullable=True)
    crn = db.Column(db.String(50), nullable=True)
    branch = db.Column(db.String(50))
    year = db.Column(db.Integer)
    approval_status = db.Column(db.String(20), default='pending')  # pending, approved, rejected
    quiz_submitted = db.Column(db.Boolean, default=False)
    score = db.Column(db.Integer, default=0)
    answers = db.Column(db.JSON, nullable=True)
    questions = db.Column(db.JSON, nullable=True)  # Store the questions that were asked
    category_scores = db.Column(db.JSON, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

# Create database tables
with app.app_context():
    db.create_all()
    # Safe migration: add approval_status if missing
    try:
        with db.engine.connect() as conn:
            result = conn.execute(db.text("PRAGMA table_info(participant)"))
            cols = [row[1] for row in result]
            if 'approval_status' not in cols:
                conn.execute(db.text("ALTER TABLE participant ADD COLUMN approval_status VARCHAR(20) DEFAULT 'pending'"))
    except Exception as e:
        logger.warning(f"Migration check failed: {e}")

# Background scheduler for email tasks
scheduler = BackgroundScheduler()
scheduler.start()

# Helper Functions
def is_authenticated():
    """Check if user is authenticated"""
    return 'user_email' in session

def is_admin():
    """Check if current user is admin"""
    admin_emails = ["thoughtz175@gmail.com"]  # Add more admin emails as needed
    return session.get("user_email") in admin_emails

def require_auth(f):
    """Decorator to require authentication"""
    def decorated_function(*args, **kwargs):
        if not is_authenticated():
            flash("Please login to access this page.", "warning")
            return redirect(url_for("index"))
        return f(*args, **kwargs)
    decorated_function.__name__ = f.__name__
    return decorated_function

def require_admin(f):
    """Decorator to require admin access"""
    def decorated_function(*args, **kwargs):
        if not is_authenticated():
            flash("Please login to access this page.", "warning")
            return redirect(url_for("index"))
        if not is_admin():
            flash("Access denied. Admin privileges required.", "danger")
            return redirect(url_for("index"))
        return f(*args, **kwargs)
    decorated_function.__name__ = f.__name__
    return decorated_function

def get_participant():
    """Get current participant from database"""
    if not is_authenticated():
        return None
    return Participant.query.filter_by(email=session["user_email"]).first()
@app.before_request
def make_session_permanent():
    session.permanent = True
@app.before_request
def restrict_mobile_devices():
    restricted_routes = ['/quiz', '/instructions', '/profile']  # yahan un pages ke route path likho
    user_agent = request.user_agent.string.lower()

    # Check only for restricted pages
    if any(request.path.startswith(r) for r in restricted_routes):
        if 'mobile' in user_agent or 'iphone' in user_agent or 'android' in user_agent or 'ipad' in user_agent:
            return redirect(url_for('device_restricted'))
# Routes
@app.route("/")
def index():
    """Home page"""
    # Clear any old flash messages
    session.pop('_flashes', None)
    return render_template("index.html")

@app.route("/google_login")
def google_login():
    """Handle Google OAuth login"""
    try:
        if not google.authorized:
            return redirect(url_for("google.login"))

        resp = google.get("/oauth2/v2/userinfo")
        if not resp.ok:
            flash("Failed to authenticate with Google. Please try again.", "danger")
            return redirect(url_for("index"))

        user_info = resp.json()
        
        # Store user info in session
        session["user_email"] = user_info["email"]
        session["user_name"] = user_info["name"]
        session["user_picture"] = user_info.get("picture")
        session["google_id"] = user_info["id"]
        if is_admin():
            return redirect(url_for("leaderboard"))
        # Check if participant already exists
        participant = Participant.query.filter_by(email=user_info["email"]).first()
        
        if participant:
            if participant.quiz_submitted:
                flash(f"Welcome back, {participant.name}! You have already completed the quiz.", "info")
                return redirect(url_for('thank_you'))
            else:
                flash(f"Welcome back, {participant.name}! Please complete your profile.", "info")
                return redirect(url_for("profile_form"))
        else:
            flash(f"Welcome, {user_info['name']}! Please complete your profile to continue.", "success")
            return redirect(url_for("profile_form"))


    except Exception as e:
        logger.error(f"Google login error: {str(e)}")
        flash("An error occurred during login. Please try again.", "danger")
        return redirect(url_for("index"))

@app.route("/logout")
def logout():
    """Logout user and clear session"""
    try:
        # Clear session
        session.clear()
        flash("You have been successfully logged out.", "success")
        return redirect(url_for("index"))
    except Exception as e:
        logger.error(f"Logout error: {str(e)}")
        flash("An error occurred during logout.", "danger")
        return redirect(url_for("index"))

@app.route("/profile", methods=["GET", "POST"])
@require_auth
def profile_form():
    """Profile completion form"""
    try:
        # Clear old flash messages on page load
        if request.method == "GET":
            session.pop('_flashes', None)
            
        existing_participant = Participant.query.filter_by(email=session["user_email"]).first()
        if existing_participant:
            flash("Profile already exists. Redirecting to instructions.", "info")
            return redirect(url_for('instructions'))
        if request.method == "POST":
            # Get form data
            urn = request.form.get("urn", "").strip()
            crn = request.form.get("crn", "").strip()
            branch = request.form.get("branch")
            year = request.form.get("year")

            # Validation
            if not branch:
                flash("Please select your branch.", "danger")
                return render_template("profile.html")

            if not year:
                flash("Please select your year.", "danger")
                return render_template("profile.html")

            # At least one of URN or CRN required
            if not urn and not crn:
                flash("Please enter either URN or CRN.", "danger")
                return render_template("profile.html")

            # Check if participant already exists


            # Create new participant
            participant = Participant(
                google_id=session["google_id"],
                name=session["user_name"],
                email=session["user_email"],
                profile_pic=session["user_picture"],
                urn=urn if urn else None,
                crn=crn if crn else None,
                branch=branch,
                year=int(year),
                approval_status='pending'
            )

            db.session.add(participant)
            db.session.commit()
            if is_admin():
                return redirect(url_for("leaderboard"))
            # Notify admin (log or email)
            try:
                logger.info(f"New profile pending approval: {participant.email}")
            except Exception:
                pass
            flash("Profile submitted. Awaiting approval.", "info")
            return redirect(url_for('pending_page'))

        return render_template("profile.html")

    except Exception as e:
        logger.error(f"Profile form error: {str(e)}")
        flash("An error occurred. Please try again.", "danger")
        return render_template("profile.html")

@app.route("/instructions")
@require_auth
def instructions():
    """Quiz instructions page"""
    try:
        # Clear old flash messages on page load
        session.pop('_flashes', None)
        if is_admin():
            return redirect(url_for("leaderboard"))
        participant = get_participant()
        if not participant:
            flash("Please complete your profile first.", "warning")
            return redirect(url_for("profile_form"))

        if participant.approval_status != 'approved':
            flash("Profile pending approval.", "warning")
            return redirect(url_for('pending_page'))

        if participant.quiz_submitted:
            flash("You have already completed the quiz.", "info")
            return redirect(url_for("thank_you"))

        return render_template("instructions.html", user_name=session.get("user_name"))

    except Exception as e:
        logger.error(f"Instructions error: {str(e)}")
        flash("An error occurred. Please try again.", "danger")
        return redirect(url_for("index"))

@app.route("/quiz", methods=["GET", "POST"])
@require_auth
def quiz():
    """Quiz page"""
    try:
        # Clear old flash messages on page load
        if request.method == "GET":
            session.pop('_flashes', None)
        if is_admin():
            return redirect(url_for("leaderboard"))
        participant = get_participant()
        if not participant:
            flash("Please complete your profile first.", "warning")
            return redirect(url_for("profile_form"))

        if participant.approval_status != 'approved':
            flash("Profile pending approval.", "warning")
            return redirect(url_for('pending_page'))

        if participant.quiz_submitted:
            flash("You cannot continue the quiz because your session has ended or you violated full-screen rules.", "warning")
            return redirect(url_for("thank_you"))

        # Quiz questions organized by sections
        questions_by_category = {
            "Math": [
                {"id": 1,
                 "question": "A bag contains 5 red, 3 green, and 2 blue marbles. If two marbles are drawn without replacement, what is the probability that both are green?",
                 "options": ["1/15", "3/10", "1/5", "1/3"], "answer": "1/15"},
                {"id": 2, "question": "A train 120 meters long passes a pole in 6 seconds. What is its speed in km/hr?",
                 "options": ["60", "72", "80", "90"], "answer": "72"},
                {"id": 3,
                 "question": "The average of five consecutive even numbers is 32. What is the smallest number?",
                 "options": ["24", "28", "30", "32"], "answer": "28"},
                {"id": 4,
                 "question": "If 12 workers can complete a work in 18 days, in how many days will 9 workers finish it?",
                 "options": ["20", "22", "24", "27"], "answer": "24"},
                {"id": 5,
                 "question": "A sum of ₹12,000 amounts to ₹15,840 in 3 years at simple interest. What is the rate of interest per annum?",
                 "options": ["8%", "9%", "10%", "12%"], "answer": "12%"},
                {"id": 6,
                 "question": "A train 180 m long passes a pole in 10 seconds. How long will it take to pass a platform 420 m long?",
                 "options": ["25 s", "30 s", "33.33 s", "40 s"], "answer": "33.33 s"},
                {"id": 7, "question": "If x² - 5x + 6 = 0 and y² - 7y + 10 = 0, find the maximum value of x + y.",
                 "options": ["6", "7", "8", "9"], "answer": "8"},
                {"id": 8,
                 "question": "A merchant mixes two varieties of rice priced at ₹40/kg and ₹70/kg to make 60 kg of mixture costing ₹55/kg. How many kg of the first variety did he mix?",
                 "options": ["20", "25", "30", "35"], "answer": "30"},
                {"id": 9,
                 "question": "If an arithmetic progression has first term 5 and common difference 3, find the sum of first 20 terms.",
                 "options": ["670", "820", "860", "900"], "answer": "670"},
                {"id": 10,
                 "question": "Two numbers are in ratio 2:3 and are in harmonic progression. Their arithmetic mean is 30. Find the numbers.",
                 "options": ["20, 40", "18, 42", "24, 36", "15, 45"], "answer": "24, 36"},
            ],
            "Reasoning": [
                {"id": 11, "question": "If A is the father of B, but B is not the son of A, who is B to A?",
                 "options": ["Daughter", "Wife", "Sister", "Mother"], "answer": "Daughter"},
                {"id": 12, "question": "Complete the series: 2, 6, 12, 20, 30, ?", "options": ["40", "42", "50", "56"],
                 "answer": "42"},
                {"id": 13, "question": "If ‘RAIN’ is coded as ‘QZHM’, what is the code for ‘CLOUD’?",
                 "options": ["BKNTC", "DKNTC", "BKMTD", "BJNTC"], "answer": "BKNTC"},
                {"id": 14, "question": "Find the odd one out: Circle, Triangle, Rectangle, Cube",
                 "options": ["Circle", "Triangle", "Rectangle", "Cube"], "answer": "Cube"},
                {"id": 15, "question": "A clock shows 3:15. What is the angle between the hour and the minute hands?",
                 "options": ["0°", "7.5°", "30°", "37.5°"], "answer": "37.5°"},
                {"id": 16,
                 "question": "In a row of 7 people A B C D E F G facing north, C is between A and D. E is to the immediate right of C. Who is in the middle?",
                 "options": ["C", "D", "E", "F"], "answer": "C"},
                {"id": 17, "question": "Find the next number: 3, 7, 15, 31, ?", "options": ["47", "63", "57", "49"],
                 "answer": "63"},
                {"id": 18, "question": "A code language: 'ALPHA' = 'ZOKSZ'. What is 'BETA' coded as?",
                 "options": ["YVUZ", "YVUZ", "YVUZ", "YVUZ"], "answer": "YVUZ"},
                {"id": 19,
                 "question": "Three boxes: GG, SS, GS. You pick a box and draw one gold coin. What is the probability that the box is GG?",
                 "options": ["1/2", "2/3", "1/3", "3/4"], "answer": "2/3"},
                {"id": 20, "question": "In a 5x5 magic square with numbers 1–25, what is the magic constant?",
                 "options": ["65", "75", "55", "85"], "answer": "65"},
            ],
            "Verbal": [
                {"id": 21, "question": "Choose the synonym of 'Adversity'.",
                 "options": ["Difficulty", "Prosperity", "Advantage", "Happiness"], "answer": "Difficulty"},
                {"id": 22, "question": "Choose the antonym of 'Transparent'.",
                 "options": ["Clear", "Opaque", "Visible", "Glassy"], "answer": "Opaque"},
                {"id": 23, "question": "Fill in the blank: The teacher insisted ____ complete honesty.",
                 "options": ["on", "in", "for", "about"], "answer": "on"},
                {"id": 24, "question": "Choose the correct spelling.",
                 "options": ["Recieve", "Receive", "Receeve", "Recievee"], "answer": "Receive"},
                {"id": 25, "question": "Identify the correctly punctuated sentence.",
                 "options": ["“Where are you going” asked the teacher.", "“Where are you going?” asked the teacher.",
                             "“Where are you going?” Asked the teacher.", "“Where are you going”? asked the teacher."],
                 "answer": "“Where are you going?” asked the teacher."},
                {"id": 26, "question": "Choose the sentence with correct parallel structure.",
                 "options": ["She likes hiking, to swim, and biking.", "She likes hiking, swimming, and biking.",
                             "She likes hiking, swim, and to bike.", "She likes to hike, swimming, and to bike."],
                 "answer": "She likes hiking, swimming, and biking."},
                {"id": 27, "question": "Identify the antonym for 'obsequious'.",
                 "options": ["servile", "independent", "fawning", "subservient"], "answer": "independent"},
                {"id": 28, "question": "Complete the analogy: Function : Input :: Algorithm : ?",
                 "options": ["Output", "Procedure", "Steps", "Complexity"], "answer": "Steps"},
                {"id": 29, "question": "Paraphrase: The committee deferred the decision until further notice.",
                 "options": ["The decision was accelerated.", "The decision was postponed.",
                             "The decision was canceled.", "The decision was revised."],
                 "answer": "The decision was postponed."},
                {"id": 30, "question": "Find the odd one out: benevolent, malevolent, virulent, resilient.",
                 "options": ["benevolent", "malevolent", "virulent", "resilient"], "answer": "resilient"}
            ]
        }

        # Select questions for quiz - ensure we get questions from each section
        quiz_questions = []
        questions_per_section = 10  # Number of questions per section
        
        for category, qlist in questions_by_category.items():
            selected = random.sample(qlist, min(questions_per_section, len(qlist)))
            for q in selected:
                q["category"] = category
                random.shuffle(q["options"])
            quiz_questions.extend(selected)

        # Keep questions grouped by section for better organization
        # Don't shuffle to maintain section grouping

        if request.method == "POST":
            # Process quiz submission
            user_answers = {}
            total_score = 0
            category_scores = {"Math": 0, "Reasoning": 0, "Verbal": 0}

            for q in quiz_questions:
                ans = request.form.getlist(f"q{q['id']}")
                user_answers[str(q['id'])] = ans
                category = q['category']

                # Check answer
                if q.get("multiple"):
                    if set(ans) == set(q["answer"]):
                        total_score += 1
                        category_scores[category] += 1
                else:
                    if ans and ans[0] == q["answer"]:
                        total_score += 1
                        category_scores[category] += 1

            # Save results
            participant.answers = user_answers
            participant.questions = quiz_questions  # Store the questions that were asked
            participant.score = total_score
            participant.category_scores = category_scores
            participant.quiz_submitted = True
            participant.updated_at = datetime.utcnow()
            
            db.session.commit()

            # Determine reason and flash appropriately
            submit_reason = request.form.get('submit_reason', '').lower()
            time_up = request.form.get('time_up', 'false').lower() == 'true'
            
            if submit_reason == 'time_up' or time_up:
                flash("Time is over, so your responses have been submitted.", "warning")
            elif submit_reason == 'beforeunload':
                flash("Quiz auto-submitted due to refresh/navigation attempt.", "warning")
            elif submit_reason == 'violation':
                flash("Quiz auto-submitted due to repeated tab switch/focus/fullscreen violations.", "warning")
            elif submit_reason == 'manual':
                flash(f"Quiz completed! Your score: {total_score}/{len(quiz_questions)}", "success")
            else:
                flash(f"Quiz completed! Your score: {total_score}/{len(quiz_questions)}", "success")
            
            return redirect(url_for("thank_you"))

        return render_template("quiz.html", questions=quiz_questions, timer=1200)

    except Exception as e:
        logger.error(f"Quiz error: {str(e)}")
        flash("An error occurred during the quiz. Please try again.", "danger")
        return redirect(url_for("instructions"))

@app.route("/thank_you")
@require_auth
def thank_you():
    """Thank you page with results"""
    try:
        # Clear old flash messages on page load
        session.pop('_flashes', None)
        if is_admin():
            return redirect(url_for("leaderboard"))
        participant = get_participant()
        if not participant:
            flash("Please complete your profile first.", "warning")
            return redirect(url_for("profile_form"))

        if not participant.quiz_submitted:
            flash("Please complete the quiz first.", "warning")
            return redirect(url_for("instructions"))
        category_scores = participant.category_scores or {"Math": 0, "Reasoning": 0, "Verbal": 0}  

        return render_template("thank_you.html", name=participant.name, score=participant.score, category_scores=category_scores)

    except Exception as e:
        logger.error(f"Thank you page error: {str(e)}")
        flash("An error occurred. Please try again.", "danger")
        return redirect(url_for("index"))

@app.route("/leaderboard")
@require_auth
@require_admin
def leaderboard():
    """Leaderboard page (admin only)"""
    try:
        return render_template("leaderboard.html")
    except Exception as e:
        logger.error(f"Leaderboard error: {str(e)}")
        flash("An error occurred loading the leaderboard.", "danger")
        return redirect(url_for("index"))

@app.route("/leaderboard_data")
@require_auth
@require_admin
def leaderboard_data():
    """API endpoint for leaderboard data (admin only)"""
    try:
        participants = Participant.query.filter_by(quiz_submitted=True).order_by(Participant.score.desc()).all()

        data = []
        for p in participants:
            data.append({
                "id": p.id,
                "email": p.email,
                "name": p.name or "Unknown",
                "score": p.score or 0,
                "category_scores": p.category_scores or {"Math": 0, "Reasoning": 0, "Verbal": 0},
                "profile_pic": p.profile_pic or None,
                "created_at": p.created_at.isoformat() if p.created_at else None
            })

        return jsonify({"success": True, "data": data})

    except Exception as e:
        logger.error(f"Leaderboard data error: {str(e)}")
        return jsonify({"success": False, "error": "Failed to load leaderboard data"}), 500

@app.route("/dev")
def dev():
    """Developer page showcasing the developer"""
    # Clear old flash messages on page load
    session.pop('_flashes', None)
    return render_template("dev.html")

@app.route('/pending')
@require_auth
def pending_page():
    # Render 404-styled page with subtle pending notice
    # We reuse 404.html, and show a tiny pending hint via query param/flash
    return render_template('404.html', pending=True)

@app.route('/admin/pending')
@require_auth
@require_admin
def admin_pending():
    pending_users = Participant.query.filter_by(approval_status='pending').all()
    data = [{
        'id': p.id,
        'name': p.name,
        'email': p.email,
        'branch': p.branch,
        'year': p.year,
        'urn': p.urn,
        'crn': p.crn,
        'created_at': p.created_at.isoformat() if p.created_at else None
    } for p in pending_users]
    return jsonify({'success': True, 'data': data})

@app.route('/admin/approve/<int:pid>', methods=['POST'])
@require_auth
@require_admin
def admin_approve(pid):
    p = Participant.query.get(pid)
    if not p:
        return jsonify({'success': False, 'error': 'Not found'}), 404
    p.approval_status = 'approved'
    db.session.commit()
    return jsonify({'success': True})

@app.route('/admin/reject/<int:pid>', methods=['POST'])
@require_auth
@require_admin
def admin_reject(pid):
    p = Participant.query.get(pid)
    if not p:
        return jsonify({'success': False, 'error': 'Not found'}), 404
    p.approval_status = 'pending'
    db.session.commit()
    return jsonify({'success': True})

@app.route('/admin/approvals')
@require_auth
@require_admin
def admin_approvals():
    return render_template('admin_pending.html')

@app.route('/device-restricted')
def device_restricted():
    """Device restriction page for mobile/tablet users"""
    return render_template('404.html', device_restricted=True)

# Async email sending
def send_email_async(app, participant_email, questions, answers, score):
    with app.app_context():
        send_email_later(participant_email, questions, answers, score)
        
@app.route("/send_quiz_email", methods=["POST"])
@require_auth
def send_quiz_email():
    """Send quiz results via email"""
    try:
        participant = get_participant()
        print("route hit")
        if not participant or not participant.quiz_submitted:
            flash("Please complete the quiz first.", "warning")
            return redirect(url_for("quiz"))

        # Get the questions that were actually asked from the database
        quiz_questions = participant.questions or []
        
        if not quiz_questions:
            flash("No quiz questions found. Please contact support.", "warning")
            return redirect(url_for("thank_you"))
        print("scheduling email")
        # Schedule email to be sent later
        print("sending email immediately")
        # Call the email function directly
        Thread(target=send_email_async, args=(app, participant.email, participant.questions, participant.answers, participant.score)).start()
        flash("Your detailed quiz results have been emailed to you!", "success")
        return redirect(url_for("thank_you"))

    except Exception as e:
        logger.error(f"Email scheduling error: {str(e)}")
        flash("Failed to schedule email. Please try again.", "danger")
        return redirect(url_for("thank_you"))

def send_email_later(participant_email, questions, answers, score):
    """Send quiz results email with detailed question analysis"""
    try:
        print("sending email")
        print(participant_email)
        print(app.config['MAIL_DEFAULT_SENDER'])
        msg = Message(
            "Your Aptitude Quiz Results - ITian Club",
            sender=app.config['MAIL_DEFAULT_SENDER'],
            recipients=[participant_email]
        )

        # Build detailed HTML content
        html_body = f"""
        <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; color: white; text-align: center;">
                <h1>ITian Club Aptitude Quiz Results</h1>
            </div>
            <div style="padding: 20px;">
                <h2>Congratulations!</h2>
                <p>Thank you for participating in the ITian Club Aptitude Quiz.</p>
                
                <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <h3>Your Score: {score}/{len(questions)}</h3>
                    <p>Percentage: {(score/len(questions))*100:.1f}%</p>
                </div>

                <h3>Detailed Question Analysis:</h3>
        """

        current_category = None
        for q in questions:
            user_ans = answers.get(str(q['id']), [])
            correct_ans = q['answer']
            
            # Add category header only once
            if q['category'] != current_category:
                html_body += f"<h4 style='color: #667eea; margin-top: 20px;'>{q['category']} Questions</h4>"
                current_category = q['category']

            # Determine if answer was correct
            is_correct = False
            if q.get("multiple"):
                is_correct = set(user_ans) == set(correct_ans)
            else:
                is_correct = user_ans and user_ans[0] == correct_ans

            status_color = "#28a745" if is_correct else "#dc3545"
            status_text = "✓ Correct" if is_correct else "✗ Incorrect"

            html_body += f"""
                <div style="background: white; border-left: 4px solid {status_color}; padding: 15px; margin: 10px 0; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <p><strong>Q{q['id']}: {q['question']}</strong></p>
                    <p style="margin: 5px 0;"><strong>Your Answer:</strong> {', '.join(user_ans) if user_ans else 'No answer'}</p>
                    <p style="margin: 5px 0;"><strong>Correct Answer:</strong> {correct_ans}</p>
                    <p style="margin: 5px 0; color: {status_color};"><strong>Status:</strong> {status_text}</p>
                </div>
            """

        html_body += """
                <hr style="margin: 30px 0;">
                <div style="background: #f8f9fa; padding: 15px; border-radius: 8px;">
                    <h4>Performance Summary:</h4>
                    <p>• Review your answers to understand where you can improve</p>
                    <p>• Focus on the categories where you scored lower</p>
                    <p>• Practice similar questions to enhance your skills</p>
                </div>
                
                <hr style="margin: 30px 0;">
                <p><em>Thank you for your participation!</em></p>
                <p><strong>– ITian Club Team</strong></p>
            </div>
        </body>
        </html>
        """

        msg.html = html_body
        mail.send(msg)
        logger.info(f"Detailed email sent successfully to {participant_email}")

    except Exception as e:
        logger.error(f"Email sending error: {str(e)}")

# Error Handlers
@app.errorhandler(404)
def not_found_error(error):
    return render_template('404.html'), 404

@app.errorhandler(500)
def internal_error(error):
    db.session.rollback()
    return render_template('500.html'), 500

@app.errorhandler(403)
def forbidden_error(error):
    return render_template('403.html'), 403

if __name__ == "__main__":
    app.run(debug=True, port=5000)
