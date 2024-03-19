const uuid = require('uuid');
const bodyParser = require('body-parser');
const fs = require('fs');

const sqlite3 = require('sqlite3').verbose()
const db = new sqlite3.Database(":memory:");

function getRow(db, sql) {
	return new Promise((resolve, reject) => {
	  db.get(sql, [], (err, row) => {
			if (err) {
				reject(err);
			} else {
				resolve(row);
			}
		});
	});
}

function getRows(db, sql) {
	return new Promise((resolve, reject) => {
	  db.all(sql, [], (err, rows) => {
		if (err) {
			reject(err);
		} else {
			resolve(rows);
		}
		});
	});
}

const getTimestamp = () => Math.floor(Date.now() / 1000);

function formatDate(dateString) {
	if (!dateString || dateString.length !== 8) {
	  throw new Error('Invalid date string format. Expected YYYYMMDD.');
	}
	const year = dateString.slice(0, 4);
	const month = dateString.slice(4, 6);
	const day = dateString.slice(6, 8);
	return `${day}/${month}/${year}`;
}

function daysAgo(dateInt) {
	if (!dateInt || dateInt.toString().length !== 8) {
	  throw new Error('Invalid date format. Expected YYYYMMDD.');
	}
	const today = new Date();
	const year = Math.floor(dateInt / 10000);
	const month = Math.floor((dateInt % 10000) / 100);
	const day = dateInt % 100;
	const pastDate = new Date(year, month - 1, day); // Months are zero-indexed
	const diffInMilliseconds = today.getTime() - pastDate.getTime();
	return Math.floor(diffInMilliseconds / (1000 * 60 * 60 * 24));
}

function getDate () {
	const today = new Date();
	const year = today.getFullYear();
	const month = String(today.getMonth() + 1).padStart(2, '0'); // Add leading zero for single-digit months
	const day = String(today.getDate()).padStart(2, '0'); // Add leading zero for single-digit days
	return `${year}${month}${day}`;
}

function reportAction(action_name) {
	data = Date.now() + "," + action_name + "\n";
	fs.appendFile("log.csv", data, (err) => {});
}

db.serialize(() => {
	db.run("CREATE TABLE tickets (id text, subject text, name text, email text, date int, state text, close_timestamp int);");
	db.run("CREATE TABLE ticket_messages (id text, ticket text, date int, title text, details text);");
	db.run("CREATE TABLE emails (id text, email text, subject text, date text, details text);");
});

const express = require('express')
const app = express()
app.use(bodyParser.urlencoded({extended: true}));

function read_file(file_name) {
	const data = fs.readFileSync("res/" + file_name, 'utf-8');
	return data;
}

app.get("/", (req, res) => {
	reportAction("Home");
	res.send(read_file("home.html"));
});

app.get("/ticket/recently_closed", async (req, res) => {
	reportAction("Ticket.RecentlyClosed");
	var html_code = read_file("recently_closed.html");

	let recently_closed_results = await getRows(db, "SELECT * FROM tickets WHERE state = 'Closed' ORDER BY close_timestamp DESC;")
	
	var results_code = "";
	var id_cache = [];

	for (var i = 0; i < recently_closed_results.length; i++) {
		results_code += "<tr onclick=\"goto_profile('" + recently_closed_results[i].id + "')\">";
		if (i < 3) {
			id_cache.push(recently_closed_results[i].id);
			const serial  = i + 1;
			results_code += "<td>Ctrl + " + serial + "</td>";
		} else {
			results_code += "<td></td>";
		}

		results_code += "<td>" + recently_closed_results[i].name + "<td>";
		results_code += "<td>" + recently_closed_results[i].date + "<td>";
		results_code += "<td>" + recently_closed_results[i].subject + "<td>";
		results_code += "<td><button class=\"w3-button w3-blue\" onclick=\"goto_profile('" + recently_closed_results[i].id + "')\">Goto Profile</button></td>";
		results_code += "</tr>";
	}

	html_code = html_code.replace("$results_code$", results_code);
	html_code = html_code.replace("$id_cache$", JSON.stringify(id_cache));
	res.send(html_code);
});

app.get("/email/add", (req, res) => {
	reportAction("Email.Add.Get");
	res.send(read_file("enter_email.html"));
});

app.post("/email/add", (req, res) => {
	reportAction("Email.Add.Post");
	const id = uuid.v4();
	const email = req.body.email;
	const subject = req.body.subject;
	const date = req.body.date;
	const details = req.body.details;
	db.run("INSERT INTO emails (id, email, subject, date, details) VALUES ('" + id + "','" + email + "', '" + subject + "', '" + date + "', '" + details + "');");
	res.redirect(301, "/");
});

app.get("/ticket/message/add", (req, res) => {
	reportAction("Ticket.Message.Add.Get");
	const ticket_id = req.query.id;
	var html_data = read_file("add_message.html");
	html_data = html_data.replace("$ticket_id$", ticket_id);
	html_data = html_data.replace("$return_ticket_id$", ticket_id);
	res.send(html_data);
});

app.post("/ticket/message/add", (req, res) => {
	reportAction("Ticket.Message.Add.Post");
	const ticket_id = req.body.ticket_id;
	const title = req.body.title;
	const details = req.body.details;
	const id = uuid.v4();
	const date = getDate();
	db.run("INSERT INTO ticket_messages (id, ticket, date, title, details) VALUES ('" + id + "','" + ticket_id + "'," + date + ", '" + title + "', '" + details + "');");
	res.redirect(301, "/ticket/view?id=" + ticket_id);
});

app.get("/ticket/search", async (req, res) => {
	reportAction("Ticket.Search");
	var html_result = read_file("search_for_ticket.html");

	if (req.query.q) {
		const search_terms = req.query.q.split(" ");

		const rows = await getRows(db, "SELECT id, name, subject, email, date, state FROM tickets;");

		var search_results_html = "";
		var results_count = 0;
		var id_cache = [];

		for (var i = 0; i < rows.length; i++) {
			var row_tokens = []
			row_tokens = row_tokens.concat(rows[i].name.split(" "));
			row_tokens = row_tokens.concat(rows[i].subject.split(" "));
			row_tokens = row_tokens.concat(rows[i].email);
			for (var x = 0; x < row_tokens.length; x++) {
				row_tokens[x] = row_tokens[x].toLowerCase();
			}
			var row_found = false;
			for (var x = 0; x < search_terms.length; x++) {
				const search_term = search_terms[x].toLowerCase();
				for (var y = 0; y < row_tokens.length; y++) {
					if (search_term == row_tokens[y] && !row_found) {
						row_found = true;
						search_results_html += "<tr onclick=\"goto_ticket('" + rows[i].id + "')\">";
						if (results_count < 3) {
							results_count ++;
							search_results_html += "<td>Ctrl + " + results_count + "</td>";
							id_cache.push(rows[i].id);
						} else {
							search_results_html += "<td></td>";
						}

						search_results_html += "<td>" + rows[i].name + "</td>";
						search_results_html += "<td>" + formatDate(rows[i].date.toString()) + " (" + daysAgo(rows[i].date) + " day(s) ago)</td>";
						if (rows[i].state == "Open") {
							search_results_html += "<td><button class=\"w3-button w3-teal\">Open</button></td>";
						} else {
							search_results_html += "<td><button class=\"w3-button w3-red\">Closed</button></td>";
						}

						search_results_html += "</tr>";
					}
				}
			}
		}

		html_result = html_result.replace("$search_results$", search_results_html);
		html_result = html_result.replace("$id_cache$", JSON.stringify(id_cache));
	} else {
		html_result = html_result.replace("$search_results$", "");
	}

	res.send(html_result);
});

app.get("/ticket/view", async (req, res) => {
	reportAction("Ticket.View");
	const id = req.query.id;

	const ticket_record = await getRow(db, "SELECT * FROM tickets where id = '" + id + "';");

	var result_html = read_file("ticket_view.html");

	result_html = result_html.replace("$name$", ticket_record.name);
	result_html = result_html.replace("$subject$", ticket_record.subject);
	result_html = result_html.replace("$email$", ticket_record.email);
	result_html = result_html.replace("$state$", ticket_record.state);
	result_html = result_html.replace("$ticket_id$", id);
	result_html = result_html.replace("$ticket_id_for_mark_close$", id);
	
	const message_records = await getRows(db, "SELECT * FROM ticket_messages WHERE ticket='" + id + "';")

	var message_html = "";

	for (var i = 0; i < message_records.length; i++) {
		message_html += "<tr>";
		message_html += "<td>" + formatDate(message_records[i].date.toString()) + "</td>";
		message_html += "<td>" + message_records[i].title + "</td>";
		message_html += "<td>" + message_records[i].details + "</td>";
		message_html += "</tr>";
	}

	result_html = result_html.replace("$message_code$", message_html);

	const email_records = await getRows(db, "SELECT * FROM emails where email = '" + ticket_record.email + "';");

	var email_html = "";
	for (var i = 0; i < email_records.length; i++) {
		email_html += "<tr>";
		email_html += "<td>" + email_records[i].date + "</td>";
		email_html += "<td>" + email_records[i].subject + "</td>";
		email_html += "<td>" + email_records[i].details + "</td>";
		email_html += "</tr>";
	}
	result_html = result_html.replace("$email_code$", email_html);

	res.send(result_html);
});

app.get("/ticket/new", (req, res) => {
	reportAction("Ticket.New.Get");
	res.send(read_file("ticket_new.html"));
});

app.post("/ticket/new", (req, res) => {
	reportAction("Ticket.New.Post");
	const id = uuid.v4();
	const subject = req.body.subject;
	const name = req.body.name;
	const email = req.body.email;
	db.run("INSERT INTO tickets (id, subject, name, email, date, state) VALUES ('" + id + "', '" + subject + "', '" + name + "', '" + email + "', " + getDate() + ", 'Open');");
	res.redirect(301, "/ticket/view?id=" + id);
});

app.get("/ticket/close", (req, res) => {
	reportAction("Ticket.Close");
	const id = req.query.id;
	db.run("UPDATE tickets set state = 'Closed', close_timestamp = " + getTimestamp() + " WHERE id = '" + id + "';");
	res.redirect(301, "/ticket/view?id=" + id);
});

app.listen(8080, () => {
	console.log("[INFO] Web server running!")
});